/**
 * PHASE 4.6 — OpenDots workspace adapter.
 *
 * Provides the `workspace` surface for workers whose genome declares the
 * `collaborative-workspace` operational need. The adapter creates (or
 * attaches to) a shared OpenDots Space + Page and exposes a
 * {@link WorkspaceSurface} for read/append/update.
 *
 * This adapter does NOT implement the full `WorkerRuntime` interface — it
 * only provides the workspace surface. It is composed into a
 * {@link CompositeRuntime} (see composite-runtime.ts) alongside the OpenBot
 * adapter, so a worker that needs both `computer` and `workspace` surfaces
 * gets both from the composite. This preserves multi-provider composition
 * without forcing either adapter to know about the other.
 *
 * Anti-bloat: one file, ~150 LOC. No upstream imports. HTTP only.
 */

import type {
  WorkspaceHandle,
  WorkspaceSurface,
} from '../computer.js';
import {
  OpenDotsClient,
  OpenDotsRevisionConflict,
} from './client.js';

export interface OpenDotsWorkspaceAdapterOptions {
  /** Base URL of the OpenDots server (default: http://127.0.0.1:4310). */
  readonly baseUrl: string;
  /** Bearer token (required for non-localhost hosts). */
  readonly token?: string;
  /**
   * Name for the OpenDots Space this adapter creates. When multiple workers
   * share a workspace, they share the same Space + Page. Default: "Genesis
   * Collaborative Workspace".
   */
  readonly spaceName?: string;
  /** Title for the shared Page. Default: "Shared Artifact". */
  readonly pageTitle?: string;
  /** Per-request timeout (default 10s). */
  readonly timeoutMs?: number;
}

/**
 * The adapter's internal record of a workspace it has created or attached to.
 * One record is shared across all workers that use the same adapter instance
 * — they collaborate on the same Space + Page.
 */
interface WorkspaceRecord {
  readonly spaceId: string;
  readonly pageId: string;
  /** Tracked revision for optimistic concurrency. Updated on each successful write. */
  revision: number;
}

/**
 * PHASE 4.6. The OpenDots workspace adapter. Creates (or attaches to) a
 * shared Space + Page and exposes a {@link WorkspaceSurface} for each worker
 * that needs collaborative workspace capability.
 *
 * The adapter is stateful: it lazily creates the Space + Page on the first
 * `ensureWorkspace` call and reuses the same record for subsequent workers.
 * This means all workers in a mission share ONE Space + ONE Page — they
 * collaborate by appending sections to the same persistent artifact.
 */
export class OpenDotsWorkspaceAdapter {
  readonly name = 'opendots-workspace-v0.1';
  private readonly client: OpenDotsClient;
  private readonly spaceName: string;
  private readonly pageTitle: string;
  private record: WorkspaceRecord | undefined;
  private readonly surfaces = new Map<string, WorkspaceSurface>();

  constructor(options: OpenDotsWorkspaceAdapterOptions) {
    this.client = new OpenDotsClient({
      baseUrl: options.baseUrl,
      ...(options.token === undefined ? {} : { token: options.token }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    this.spaceName = options.spaceName ?? 'Genesis Collaborative Workspace';
    this.pageTitle = options.pageTitle ?? 'Shared Artifact';
  }

  /**
   * Ensure the shared workspace exists (create if absent) and return a
   * {@link WorkspaceSurface} for the given worker. The surface is cached per
   * worker id — the same worker gets the same surface instance.
   */
  async ensureWorkspace(workerId: string): Promise<WorkspaceSurface> {
    const existing = this.surfaces.get(workerId);
    if (existing !== undefined) return existing;

    const record = await this.ensureRecord();
    const surface = this.makeSurface(workerId, record);
    this.surfaces.set(workerId, surface);
    return surface;
  }

  /** Release a worker's workspace surface (no-op for OpenDots — the Page persists). */
  async releaseWorkspace(workerId: string): Promise<void> {
    this.surfaces.delete(workerId);
  }

  /** The shared workspace handle, for evidence/provenance. */
  getWorkspaceHandle(): WorkspaceHandle | undefined {
    if (this.record === undefined) return undefined;
    return {
      provider: 'opendots',
      spaceId: this.record.spaceId,
      pageId: this.record.pageId,
      revision: this.record.revision,
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async ensureRecord(): Promise<WorkspaceRecord> {
    if (this.record !== undefined) return this.record;
    // Create the Space.
    const space = await this.client.createSpace(this.spaceName, 'Genesis collaborative workspace');
    // Create the initial Page.
    const page = await this.client.createPage(
      space.id,
      this.pageTitle,
      `# ${this.pageTitle}\n\n_Created by AgentCraft Genesis._\n`,
    );
    this.record = { spaceId: space.id, pageId: page.id, revision: page.revision };
    return this.record;
  }

  private makeSurface(workerId: string, record: WorkspaceRecord): WorkspaceSurface {
    const client = this.client;
    const writeWithRetry = (content: string, expectedRevision: number) =>
      this.writeWithRetry(record, content, expectedRevision);
    const handle: WorkspaceHandle = {
      provider: 'opendots',
      spaceId: record.spaceId,
      pageId: record.pageId,
      revision: record.revision,
    };
    return {
      handle,
      async readPage() {
        const page = await client.getPage(record.spaceId, record.pageId);
        // Sync the adapter's tracked revision.
        record.revision = page.revision;
        return { content: page.content, revision: page.revision };
      },
      async appendContent(contributor: string, section: string) {
        // Read the current content (handles revision drift from other workers).
        const current = await client.getPage(record.spaceId, record.pageId);
        const newContent =
          current.content +
          `\n\n## ${contributor}\n\n${section}\n`;
        return writeWithRetry(newContent, current.revision);
      },
      async updatePage(content: string) {
        const current = await client.getPage(record.spaceId, record.pageId);
        return writeWithRetry(content, current.revision);
      },
    };
  }

  /**
   * Write with one retry on revision conflict. Updates the record's tracked
   * revision on success. Fails loudly on second conflict.
   */
  private async writeWithRetry(
    record: WorkspaceRecord,
    content: string,
    expectedRevision: number,
  ): Promise<{ revision: number }> {
    try {
      const updated = await this.client.updatePage(
        record.spaceId,
        record.pageId,
        content,
        expectedRevision,
      );
      record.revision = updated.revision;
      return { revision: updated.revision };
    } catch (error) {
      if (error instanceof OpenDotsRevisionConflict) {
        // One retry: re-read and re-write with the current revision.
        const current = await this.client.getPage(record.spaceId, record.pageId);
        const retryContent = content; // same content, fresh revision
        const updated = await this.client.updatePage(
          record.spaceId,
          record.pageId,
          retryContent,
          current.revision,
        );
        record.revision = updated.revision;
        return { revision: updated.revision };
      }
      throw error;
    }
  }
}
