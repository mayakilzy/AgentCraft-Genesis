/**
 * Experience Store (TASK-024) — durable persistence for organizational
 * Experience records.
 *
 * Two implementations only — what Group 4 actually consumes:
 *   - MemoryExperienceStore: tests and in-memory runs;
 *   - FileExperienceStore: durable JSONL persistence, the same pattern as the
 *     Flight Recorder (one append-only file, one record per line, durable
 *     across process restarts, inspectable by humans).
 *
 * No database framework. No vector store. No migration engine. The schema
 * carries a `schemaVersion` so a future bump can migrate in place; for v0.1
 * the file is authoritative and append-only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Experience } from './experience.js';

/** The port the learning loop reads and writes experiences through. */
export interface ExperienceStore {
  readonly name: string;
  /** Persist an experience. Replaces an existing one with the same id. */
  record(experience: Experience): void;
  /** Retrieve one experience by id, or undefined when absent. */
  retrieve(id: string): Experience | undefined;
  /** All recorded experiences, in insertion order. */
  all(): readonly Experience[];
  /** Filter experiences by predicate. */
  filter(predicate: (experience: Experience) => boolean): readonly Experience[];
}

/** In-memory store — tests and short-lived runs. */
export class MemoryExperienceStore implements ExperienceStore {
  readonly name = 'memory-experience-store';
  private readonly experiences = new Map<string, Experience>();
  private readonly order: string[] = [];

  record(experience: Experience): void {
    if (!this.experiences.has(experience.id)) {
      this.order.push(experience.id);
    }
    this.experiences.set(experience.id, experience);
  }

  retrieve(id: string): Experience | undefined {
    return this.experiences.get(id);
  }

  all(): readonly Experience[] {
    return this.order.map((id) => this.experiences.get(id)!).filter(Boolean);
  }

  filter(predicate: (experience: Experience) => boolean): readonly Experience[] {
    return this.all().filter(predicate);
  }
}

export interface FileExperienceStoreOptions {
  /** Directory for the experience file (created if absent). */
  readonly dir: string;
  /** Filename inside dir; defaults to "experiences.jsonl". */
  readonly filename?: string;
}

/**
 * Durable JSONL experience store. One record per line, append-only on write.
 * Replaces an existing record with the same id by rewriting the file (the
 * file is small — experiences are summaries, not payloads).
 */
export class FileExperienceStore implements ExperienceStore {
  readonly name = 'file-experience-store';
  private readonly path: string;
  private cache: Experience[] | undefined;

  constructor(options: FileExperienceStoreOptions) {
    mkdirSync(options.dir, { recursive: true });
    this.path = join(options.dir, options.filename ?? 'experiences.jsonl');
  }

  record(experience: Experience): void {
    const all = this.load();
    const existingIndex = all.findIndex((item) => item.id === experience.id);
    if (existingIndex === -1) {
      all.push(experience);
    } else {
      all[existingIndex] = experience;
    }
    // Append-only is the Flight Recorder pattern; here we rewrite because
    // experiences are REPLACED by id (a re-derived experience for the same
    // mission supersedes the prior one). The file is small and human-readable.
    writeFileSync(
      this.path,
      all.map((exp) => JSON.stringify(exp)).join('\n') + (all.length > 0 ? '\n' : ''),
      'utf8',
    );
    this.cache = all;
  }

  retrieve(id: string): Experience | undefined {
    return this.load().find((exp) => exp.id === id);
  }

  all(): readonly Experience[] {
    return this.load();
  }

  filter(predicate: (experience: Experience) => boolean): readonly Experience[] {
    return this.load().filter(predicate);
  }

  private load(): Experience[] {
    if (this.cache !== undefined) return this.cache;
    if (!existsSync(this.path)) {
      this.cache = [];
      return this.cache;
    }
    const text = readFileSync(this.path, 'utf8');
    this.cache = text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Experience);
    return this.cache;
  }
}
