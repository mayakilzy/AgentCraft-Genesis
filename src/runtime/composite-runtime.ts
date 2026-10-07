/**
 * PHASE 4.6 — Composite runtime.
 *
 * Composes multiple provider-specific adapters into one `WorkerRuntime`. A
 * worker whose genome declares multiple operational needs (e.g.
 * `shell-execution` + `collaborative-workspace`) gets surfaces from BOTH
 * adapters: `{ computer, workspace }`.
 *
 * This is the multi-provider composition seam. It preserves the Phase 4.5
 * invariant: the orchestrator calls `surfaces(handle)` and reads whatever is
 * present. The composite decides which adapter provides which surface based
 * on the genome's `operationalNeeds`.
 *
 * Anti-bloat: one small file. No new dependencies. No provider-specific
 * branching in the orchestrator — the composite owns the composition.
 */

import type {
  RuntimeHandle,
  WorkerGenome,
} from '../contracts/core.js';
import type {
  JobSurface,
  WorkerComputer,
  WorkerRuntime,
  WorkerSurfaces,
  WorkspaceSurface,
} from './computer.js';
import type { OpenDotsWorkspaceAdapter } from './opendots/adapter.js';
import type { OpenMuseAdapter } from './openmuse/adapter.js';

export interface CompositeRuntimeOptions {
  /**
   * The computer-runtime adapter (OpenBot). Provides the `computer` surface
   * for workers whose genome declares shell-execution/browser/workspace-files
   * needs. Required — every existing worker uses the computer path.
   */
  readonly computer: WorkerRuntime;
  /**
   * PHASE 4.6. The workspace adapter (OpenDots). Provides the `workspace`
   * surface for workers whose genome declares `collaborative-workspace`.
   * Optional — when absent, no worker gets a workspace surface (Phase 4.5
   * behavior).
   */
  readonly workspace?: OpenDotsWorkspaceAdapter;
  /**
   * PHASE 4.7. The durable work adapter (OpenMuse). Provides the `job`
   * surface for workers whose genome declares `durable-delegation`.
   * Optional — when absent, no worker gets a job surface.
   */
  readonly job?: OpenMuseAdapter;
}

/**
 * The internal record the composite keeps for each ensured worker: the
 * computer-runtime handle (when the worker needs a computer) and the
 * workspace surface (when the worker needs collaborative workspace).
 */
interface CompositeEntry {
  readonly workerId: string;
  readonly computerHandle: RuntimeHandle | null;
  readonly workspaceSurface: WorkspaceSurface | null;
  readonly jobSurface: JobSurface | null;
}

/**
 * PHASE 4.6. A `WorkerRuntime` that composes a computer adapter (OpenBot)
 * and a workspace adapter (OpenDots). The orchestrator sees one runtime;
 * the composite dispatches to the right adapter(s) based on the genome's
 * `operationalNeeds`.
 *
 * The composite does NOT implement `computer(handle)` directly — it delegates
 * to the computer adapter. This method is kept for backward compatibility
 * (the verifier uses it). New code calls `surfaces(handle)`.
 */
export class CompositeRuntime implements WorkerRuntime {
  readonly name = 'composite-runtime-v0.1';
  private readonly computerRuntime: WorkerRuntime;
  private readonly workspaceAdapter: OpenDotsWorkspaceAdapter | undefined;
  private readonly jobAdapter: OpenMuseAdapter | undefined;
  private readonly entries = new Map<string, CompositeEntry>();

  constructor(options: CompositeRuntimeOptions) {
    this.computerRuntime = options.computer;
    this.workspaceAdapter = options.workspace;
    this.jobAdapter = options.job;
  }

  async ensureWorker(genome: WorkerGenome): Promise<RuntimeHandle> {
    const workerId = genome.identity.id;
    const needs = genome.operationalNeeds ?? [];
    const needKinds = new Set(needs.map((n) => n.kind));

    // Determine which surfaces this worker needs.
    const needsComputer = genome.computer.required;
    const needsWorkspace =
      needKinds.has('collaborative-workspace') && this.workspaceAdapter !== undefined;
    const needsJob =
      needKinds.has('durable-delegation') && this.jobAdapter !== undefined;

    // Ensure the computer handle (when needed).
    let computerHandle: RuntimeHandle | null = null;
    if (needsComputer) {
      computerHandle = await this.computerRuntime.ensureWorker(genome);
    }

    // Ensure the workspace surface (when needed).
    let workspaceSurface: WorkspaceSurface | null = null;
    if (needsWorkspace) {
      workspaceSurface = await this.workspaceAdapter!.ensureWorkspace(workerId);
    }

    // Ensure the job surface (when needed).
    let jobSurface: JobSurface | null = null;
    if (needsJob) {
      jobSurface = await this.jobAdapter!.ensureJob(workerId);
    }

    // The composite handle's `ref` encodes which surfaces are present.
    const computerRef = computerHandle?.ref ?? 'none';
    const workspaceRef = workspaceSurface !== null ? 'workspace' : 'none';
    const jobRef = jobSurface !== null ? 'job' : 'none';
    const ref = `composite:${workerId}:${computerRef}:${workspaceRef}:${jobRef}`;

    this.entries.set(workerId, {
      workerId,
      computerHandle,
      workspaceSurface,
      jobSurface,
    });

    return { workerId, ref };
  }

  computer(handle: RuntimeHandle): WorkerComputer {
    // Delegate to the computer adapter. The verifier uses this method.
    const entry = this.entries.get(handle.workerId);
    if (entry === undefined || entry.computerHandle === null) {
      throw new Error(
        `worker "${handle.workerId}" has no computer surface (genome.computer.required is false)`,
      );
    }
    return this.computerRuntime.computer(entry.computerHandle);
  }

  surfaces(handle: RuntimeHandle): WorkerSurfaces {
    const entry = this.entries.get(handle.workerId);
    if (entry === undefined) {
      return {};
    }
    return {
      ...(entry.computerHandle !== null
        ? { computer: this.computerRuntime.computer(entry.computerHandle) }
        : {}),
      ...(entry.workspaceSurface !== null
        ? { workspace: entry.workspaceSurface }
        : {}),
      ...(entry.jobSurface !== null
        ? { job: entry.jobSurface }
        : {}),
    };
  }

  async stopWorker(handle: RuntimeHandle): Promise<void> {
    const entry = this.entries.get(handle.workerId);
    if (entry === undefined) return;
    // Release both surfaces. Computer stop is best-effort. Workspace release
    // is a no-op for OpenDots (the Page persists).
    if (entry.computerHandle !== null) {
      try {
        await this.computerRuntime.stopWorker(entry.computerHandle);
      } catch {
        // best-effort
      }
    }
    if (entry.workspaceSurface !== null && this.workspaceAdapter !== undefined) {
      try {
        await this.workspaceAdapter.releaseWorkspace(handle.workerId);
      } catch {
        // best-effort
      }
    }
    if (entry.jobSurface !== null && this.jobAdapter !== undefined) {
      try {
        await this.jobAdapter.releaseJob(handle.workerId);
      } catch {
        // best-effort — the task persists on OpenMuse regardless
      }
    }
    this.entries.delete(handle.workerId);
  }
}
