/**
 * G7-12 — Durable Conversation Store.
 *
 * Persists conversations and messages as JSONL files on disk, mirroring the
 * existing FileFlightRecorder / FileExperienceStore / ArtifactRegistry pattern.
 *
 * Storage layout:
 *   data/conversations/{conversationId}.conv.json   — conversation metadata (rewrite-by-id)
 *   data/conversations/{conversationId}.msgs.jsonl  — messages (append-only)
 *
 * Ownership: every record carries `callerId`. All reads filter by callerId.
 * No cross-caller access is possible through this store.
 *
 * Durability: files persist across gateway restart. Conversations survive
 * process restart. Mission execution state (in MissionService) does NOT
 * survive restart — the conversation stores only missionId REFERENCES, and
 * the UI retrieves live mission state via the existing Gateway API. If a
 * mission is no longer retrievable, the UI shows "unavailable" — never
 * fabricates completion.
 */
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationRecord {
  readonly conversationId: string;
  readonly callerId: string;
  title: string;
  readonly createdAt: string;
  updatedAt: string;
  status: 'active' | 'archived';
  missionIds: string[];
}

export interface MessageRecord {
  readonly messageId: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: string;
  readonly missionId?: string;
  readonly idempotencyKey?: string;
}

export interface ConversationSummary {
  readonly conversationId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: 'active' | 'archived';
  readonly missionIds: readonly string[];
  readonly messageCount: number;
  readonly lastMessagePreview?: string;
}

export interface CreateConversationInput {
  readonly title?: string;
  readonly firstMessage?: string;
}

export interface AppendMessageInput {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly missionId?: string;
  readonly idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`conversation not found: ${conversationId}`);
    this.name = 'ConversationNotFoundError';
  }
}

export class ConversationOwnershipError extends Error {
  constructor(conversationId: string) {
    super(`conversation not owned by caller: ${conversationId}`);
    this.name = 'ConversationOwnershipError';
  }
}

export class MessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageValidationError';
  }
}

// ---------------------------------------------------------------------------
// FileConversationStore
// ---------------------------------------------------------------------------

const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 10_000;
const MAX_MESSAGES_PER_CONVERSATION = 10_000;

export interface ConversationStoreOptions {
  readonly dir?: string;
}

export class FileConversationStore {
  private readonly dir: string;

  constructor(options: ConversationStoreOptions = {}) {
    this.dir = options.dir ?? 'data/conversations';
    mkdirSync(this.dir, { recursive: true });
  }

  // --- Conversation CRUD ---

  createConversation(callerId: string, input: CreateConversationInput): ConversationRecord {
    const conversationId = randomUUID();
    const now = new Date().toISOString();
    const title = (input.title ?? 'New Conversation').slice(0, MAX_TITLE_LENGTH);
    const record: ConversationRecord = {
      conversationId,
      callerId,
      title,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      missionIds: [],
    };
    this.writeConversation(record);
    if (input.firstMessage !== undefined && input.firstMessage.trim().length > 0) {
      this.appendMessage(conversationId, callerId, {
        role: 'user',
        content: input.firstMessage,
      });
    }
    return record;
  }

  getConversation(conversationId: string, callerId: string): ConversationRecord {
    const record = this.readConversation(conversationId);
    if (record === undefined) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (record.callerId !== callerId) {
      throw new ConversationOwnershipError(conversationId);
    }
    return record;
  }

  listConversations(
    callerId: string,
    options: { readonly limit?: number; readonly cursor?: string } = {},
  ): { conversations: ConversationSummary[]; nextCursor: string | null } {
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const cursor = options.cursor;
    const summaries: ConversationSummary[] = [];

    const files = readdirSync(this.dir).filter((f) => f.endsWith('.conv.json'));
    for (const file of files) {
      const conversationId = file.replace('.conv.json', '');
      const record = this.readConversation(conversationId);
      if (record === undefined || record.callerId !== callerId) continue;
      const messages = this.readMessages(conversationId);
      const lastMsg = messages.length > 0 ? messages[messages.length - 1] : undefined;
      summaries.push({
        conversationId: record.conversationId,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        status: record.status,
        missionIds: record.missionIds,
        messageCount: messages.length,
        lastMessagePreview: lastMsg?.content.slice(0, 100),
      });
    }

    summaries.sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) {
        return a.updatedAt > b.updatedAt ? -1 : 1;
      }
      return a.conversationId > b.conversationId ? -1 : a.conversationId < b.conversationId ? 1 : 0;
    });

    let startIndex = 0;
    if (cursor !== undefined && cursor.length > 0) {
      const cursorIdx = summaries.findIndex((s) => s.conversationId === cursor);
      if (cursorIdx >= 0) {
        startIndex = cursorIdx + 1;
      } else {
        return { conversations: [], nextCursor: null };
      }
    }

    const page = summaries.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < summaries.length;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].conversationId : null;
    return { conversations: page, nextCursor };
  }

  updateConversationTitle(conversationId: string, callerId: string, title: string): ConversationRecord {
    const record = this.getConversation(conversationId, callerId);
    record.title = title.slice(0, MAX_TITLE_LENGTH);
    record.updatedAt = new Date().toISOString();
    this.writeConversation(record);
    return record;
  }

  // --- Messages ---

  appendMessage(
    conversationId: string,
    callerId: string,
    input: AppendMessageInput,
  ): MessageRecord {
    const record = this.getConversation(conversationId, callerId);

    if (input.content.trim().length === 0) {
      throw new MessageValidationError('message content must be non-empty');
    }
    if (input.content.length > MAX_MESSAGE_LENGTH) {
      throw new MessageValidationError(`message exceeds ${MAX_MESSAGE_LENGTH} chars`);
    }

    if (input.idempotencyKey !== undefined) {
      const existing = this.readMessages(conversationId).find(
        (m) => m.idempotencyKey === input.idempotencyKey,
      );
      if (existing !== undefined) {
        return existing;
      }
    }

    const messages = this.readMessages(conversationId);
    if (messages.length >= MAX_MESSAGES_PER_CONVERSATION) {
      throw new MessageValidationError(`conversation reached ${MAX_MESSAGES_PER_CONVERSATION} message limit`);
    }

    const now = new Date().toISOString();
    const seq = messages.length > 0 ? messages[messages.length - 1].seq + 1 : 0;
    const message: MessageRecord = {
      messageId: randomUUID(),
      conversationId,
      seq,
      role: input.role,
      content: input.content,
      createdAt: now,
      ...(input.missionId !== undefined ? { missionId: input.missionId } : {}),
      ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
    };

    appendFileSync(this.msgsPath(conversationId), `${JSON.stringify(message)}\n`, 'utf8');

    record.updatedAt = now;
    this.writeConversation(record);

    return message;
  }

  getMessages(
    conversationId: string,
    callerId: string,
    options: { readonly limit?: number; readonly cursor?: string } = {},
  ): { messages: MessageRecord[]; nextCursor: string | null } {
    this.getConversation(conversationId, callerId);

    const limit = Math.max(1, Math.min(100, options.limit ?? 50));
    const cursor = options.cursor;
    const all = this.readMessages(conversationId);

    let startIndex = 0;
    if (cursor !== undefined && cursor.length > 0) {
      const cursorSeq = Number.parseInt(cursor, 10);
      if (!Number.isFinite(cursorSeq)) {
        return { messages: [], nextCursor: null };
      }
      startIndex = all.findIndex((m) => m.seq === cursorSeq);
      if (startIndex < 0) {
        return { messages: [], nextCursor: null };
      }
      startIndex += 1;
    }

    const page = all.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < all.length;
    const nextCursor = hasMore && page.length > 0 ? String(page[page.length - 1].seq) : null;
    return { messages: page, nextCursor };
  }

  // --- Mission Links ---

  linkMission(conversationId: string, callerId: string, missionId: string): ConversationRecord {
    const record = this.getConversation(conversationId, callerId);
    if (!record.missionIds.includes(missionId)) {
      record.missionIds.push(missionId);
      record.updatedAt = new Date().toISOString();
      this.writeConversation(record);
    }
    return record;
  }

  // --- Internal file I/O ---

  private convPath(conversationId: string): string {
    return join(this.dir, `${conversationId}.conv.json`);
  }

  private msgsPath(conversationId: string): string {
    return join(this.dir, `${conversationId}.msgs.jsonl`);
  }

  private writeConversation(record: ConversationRecord): void {
    writeFileSync(this.convPath(record.conversationId), JSON.stringify(record, null, 2), 'utf8');
  }

  private readConversation(conversationId: string): ConversationRecord | undefined {
    const path = this.convPath(conversationId);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as ConversationRecord;
    } catch {
      return undefined;
    }
  }

  private readMessages(conversationId: string): MessageRecord[] {
    const path = this.msgsPath(conversationId);
    if (!existsSync(path)) return [];
    const out: MessageRecord[] = [];
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        out.push(JSON.parse(trimmed) as MessageRecord);
      } catch {
        // Skip corrupted line.
      }
    }
    return out;
  }
}
