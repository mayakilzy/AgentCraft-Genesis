import type { GitWorkspace } from './git-workspace.js';

/**
 * Multi-Worker Integration Manager (TASK-020): merge the work of several
 * workers with the smallest coordination layer that is honest.
 *
 * What it does: inspect each worker branch's diff, detect overlapping edits
 * BEFORE merging, merge in a deterministic order inside the clean
 * integration worktree, and roll the integration branch back to base when a
 * merge must be undone. Conflicts fail safely and structurally — the report
 * names the files and the branches; nothing is resolved silently.
 *
 * What it deliberately is not: a distributed transaction system, a merge
 * policy engine, or a code-review stage. Verification of the INTEGRATED
 * result is the verifier's job (clean-room clone + gates); this manager only
 * produces the integrated state and an honest report of how it got there.
 */

export interface WorkerDiff {
  readonly workerId: string;
  readonly branch: string;
  readonly files: readonly string[];
}

export interface IntegrationConflict {
  readonly file: string;
  readonly attemptedMergeOf: readonly string[];
}

export interface IntegrationReport {
  readonly ok: boolean;
  /** Worker ids merged, in the order they were merged. */
  readonly merged: readonly string[];
  /** Files edited by more than one worker (informational, pre-merge). */
  readonly overlappingFiles: readonly string[];
  /** Conflicts encountered (the failing merge was aborted; see detail). */
  readonly conflicts: readonly IntegrationConflict[];
  /** Worker ids never merged because integration stopped at a conflict. */
  readonly unmerged: readonly string[];
  readonly detail: string;
}

export interface IntegrationManagerOptions {
  /** Worker ids in merge order (plan order — deterministic by construction). */
  readonly order: readonly string[];
}

export class IntegrationManager {
  private readonly workspace: GitWorkspace;
  private readonly order: readonly string[];

  constructor(workspace: GitWorkspace, options: IntegrationManagerOptions) {
    this.workspace = workspace;
    this.order = options.order.filter((id) => id !== 'integration');
  }

  /** Per-worker diffs relative to the mission base. */
  async inspect(): Promise<readonly WorkerDiff[]> {
    const diffs: WorkerDiff[] = [];
    for (const workerId of this.order) {
      diffs.push({
        workerId,
        branch: `genesis/${workerId}`,
        files: await this.workspace.changedFiles(workerId),
      });
    }
    return diffs;
  }

  /** Files edited by more than one worker — the risk surface, before merging. */
  async overlappingFiles(): Promise<readonly string[]> {
    const diffs = await this.inspect();
    const count = new Map<string, string[]>();
    for (const diff of diffs) {
      for (const file of diff.files) {
        count.set(file, [...(count.get(file) ?? []), diff.workerId]);
      }
    }
    return [...count.entries()]
      .filter(([, workers]) => workers.length > 1)
      .map(([file]) => file)
      .sort();
  }

  /**
   * Merge every worker branch into the integration branch, in order. A
   * conflicting merge is aborted (the integration branch keeps its last good
   * state) and integration STOPS: the conflict is reported with its files,
   * the remaining workers are listed as unmerged, and nothing is faked.
   */
  async integrate(): Promise<IntegrationReport> {
    await this.workspace.ensureIntegrationWorktree();
    const overlapping = await this.overlappingFiles();
    const merged: string[] = [];
    for (const workerId of this.order) {
      const result = await this.workspace.mergeIntoIntegration(workerId);
      if (!result.ok) {
        return {
          ok: false,
          merged,
          overlappingFiles: overlapping,
          conflicts: result.conflicts.map((file) => ({
            file,
            attemptedMergeOf: [workerId, ...merged.slice().reverse()],
          })),
          unmerged: this.order.slice(this.order.indexOf(workerId)),
          detail:
            `merge of "${workerId}" conflicted on ` +
            `${result.conflicts.length} file(s) (${result.conflicts.join(', ')}); ` +
            `the failing merge was aborted and the integration branch holds ` +
            `the previous good state`,
        };
      }
      merged.push(workerId);
    }
    return {
      ok: true,
      merged,
      overlappingFiles: overlapping,
      conflicts: [],
      unmerged: [],
      detail:
        merged.length === 0
          ? 'no worker branches had changes to integrate'
          : `merged ${merged.join(' → ')} onto genesis/integration` +
            (overlapping.length > 0
              ? `; overlapping edits on ${overlapping.join(', ')} merged cleanly`
              : ''),
    };
  }

  /** Roll the integration branch back to the mission base. */
  async rollback(): Promise<void> {
    await this.workspace.resetIntegration();
  }
}
