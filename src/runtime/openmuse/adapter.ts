/**
 * PHASE 4.7 — OpenMuse durable work adapter.
 *
 * Provides the `job` surface for workers whose genome declares the
 * `durable-delegation` operational need. The adapter creates a durable task
 * on the OpenMuse server and exposes a {@link JobSurface} for status/result
 * inspection.
 *
 * This adapter is composed into a {@link CompositeRuntime} alongside the
 * OpenBot (computer) and OpenDots (workspace) adapters. A worker that needs
 * durable delegation gets the `job` surface; a worker that needs multiple
 * surfaces gets all of them.
 *
 * Anti-bloat: one file, ~150 LOC. No upstream imports. HTTP only.
 */

import type { JobHandle, JobStatus, JobSurface } from '../computer.js';
import {
  OpenMuseClient,
  OpenMuseRequestError,
  type OpenMuseTask,
  type OpenMuseTaskStatus,
} from './client.js';

export interface OpenMuseAdapterOptions {
  /** Base URL of the OpenMuse server (default: http://127.0.0.1:8787). */
  readonly baseUrl: string;
  /** Per-request timeout (default 15s). */
  readonly timeoutMs?: number;
  /**
   * The task prompt for durable delegated work. When multiple workers share
   * the adapter, each gets its own task (durable work is per-worker, not
   * shared like a workspace).
   */
  readonly taskPrompt?: string;
  /** The task kind (default: 'finance' — deterministic, no model needed). */
  readonly taskKind?: string;
  /** The task input (kind-specific). */
  readonly taskInput?: Record<string, unknown>;
}

/**
 * PHASE 4.7. The OpenMuse durable work adapter. Creates a durable task on
 * the OpenMuse server for each worker that needs durable delegation. Each
 * worker gets its own task and its own JobSurface.
 *
 * The adapter is stateful: it caches tasks per worker. The task persists on
 * the OpenMuse server (in PGlite/PostgreSQL) and survives process restarts.
 * Recovery is handled by OpenMuse's lease/queue mechanism — Genesis observes
 * the result, it does not own the recovery.
 */
export class OpenMuseAdapter {
  readonly name = 'openmuse-durable-v0.1';
  private readonly client: OpenMuseClient;
  private readonly taskPrompt: string;
  private readonly taskKind: string;
  private readonly taskInput: Record<string, unknown>;
  private readonly surfaces = new Map<string, JobSurface>();

  constructor(options: OpenMuseAdapterOptions) {
    this.client = new OpenMuseClient({
      baseUrl: options.baseUrl,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    this.taskPrompt = options.taskPrompt ?? 'Analyze the provided data and produce a summary.';
    this.taskKind = options.taskKind ?? 'finance';
    this.taskInput = options.taskInput ?? { csv: 'date,amount,desc\n2026-01-01,10,Coffee\n2026-01-02,20,Lunch' };
  }

  /**
   * Ensure a durable task exists for the given worker. Creates the task on
   * the OpenMuse server if it doesn't exist yet. Returns a {@link JobSurface}
   * for status/result inspection.
   */
  async ensureJob(workerId: string): Promise<JobSurface> {
    const existing = this.surfaces.get(workerId);
    if (existing !== undefined) return existing;

    // Create the durable task on OpenMuse.
    const task = await this.client.createTask(
      this.taskPrompt,
      this.taskKind,
      this.taskInput,
    );
    const surface = this.makeSurface(task);
    this.surfaces.set(workerId, surface);
    return surface;
  }

  /** Release a worker's job surface (does NOT cancel the task — it persists). */
  async releaseJob(workerId: string): Promise<void> {
    this.surfaces.delete(workerId);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private makeSurface(task: OpenMuseTask): JobSurface {
    const client = this.client;
    const handle: JobHandle = {
      provider: 'openmuse',
      taskId: task.id,
    };
    return {
      handle,
      async getStatus(): Promise<JobStatus> {
        const detail = await client.getTask(task.id);
        return mapStatus(detail.task.status);
      },
      async getResult(): Promise<string | undefined> {
        const detail = await client.getTask(task.id);
        if (detail.task.status !== 'succeeded') return undefined;
        return detail.task.result;
      },
      async cancel(): Promise<void> {
        try {
          await client.controlTask(task.id, 'cancel');
        } catch (error) {
          if (error instanceof OpenMuseRequestError && error.status === 409) {
            // Task is already terminal — nothing to cancel.
            return;
          }
          throw error;
        }
      },
    };
  }
}

/**
 * Map OpenMuse task status to Genesis JobStatus. OpenMuse has more states
 * (waiting_approval, waiting_input, scheduled) — these are mapped to 'paused'
 * (the worker is waiting for external input/approval, not actively running).
 */
function mapStatus(status: OpenMuseTaskStatus): JobStatus {
  switch (status) {
    case 'queued':
    case 'scheduled':
      return 'queued';
    case 'running':
      return 'running';
    case 'waiting_approval':
    case 'waiting_input':
    case 'paused':
      return 'paused';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'queued';
  }
}
