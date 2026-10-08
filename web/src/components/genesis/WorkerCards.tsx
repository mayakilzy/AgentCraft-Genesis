"use client";

import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ObservedWorker } from "@/lib/genesis/events";
import { cn } from "@/lib/utils";

interface WorkerCardsProps {
  workers: Record<string, ObservedWorker>;
}

/**
 * WorkerCards — render one card per observed worker.
 *
 * Per 02_PRODUCT_SPECIFICATION §Agent + 03_UI_UX_CONTRACT §Agent behavior:
 *   - Each card shows server ID, role/objective/status, model/provider if
 *     returned, tools/skills, resource policy and actual events.
 *   - Hide absent optional data or label unknown.
 *   - NO fabricated worker genomes. Only fields actually present in event
 *     payloads are shown.
 */
export function WorkerCards({ workers }: WorkerCardsProps) {
  const entries = Object.values(workers).sort((a, b) => {
    // Sort by first-seen timestamp (oldest first).
    return (a.firstSeenAt ?? "").localeCompare(b.firstSeenAt ?? "");
  });

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        No workers observed yet. Worker cards appear here once the mission
        produces <code className="font-mono">plan-created</code> or{" "}
        <code className="font-mono">worker-started</code> events.
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {entries.map((w) => (
        <WorkerCard key={w.id} worker={w} />
      ))}
    </div>
  );
}

function WorkerCard({ worker: w }: { worker: ObservedWorker }) {
  const terminal = w.terminalStatus;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-mono text-xs truncate" title={w.id}>
            {w.id}
          </CardTitle>
          {terminal === "success" && (
            <Badge className="bg-success/15 text-success border-success/30 gap-1">
              <CheckCircle2 className="size-3" aria-hidden="true" />
              Succeeded
            </Badge>
          )}
          {terminal === "failure" && (
            <Badge className="bg-destructive/15 text-destructive border-destructive/30 gap-1">
              <XCircle className="size-3" aria-hidden="true" />
              Failed
            </Badge>
          )}
          {terminal === undefined && w.retryCount && w.retryCount > 0 && (
            <Badge className="bg-warning/15 text-warning border-warning/30 gap-1">
              <RefreshCw className="size-3" aria-hidden="true" />
              Retrying ({w.retryCount})
            </Badge>
          )}
          {terminal === undefined && (!w.retryCount || w.retryCount === 0) && (
            <Badge className="bg-primary/10 text-primary border-primary/30 gap-1">
              Active
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <Field label="Role" value={w.role} mono={false} />
        <Field label="Reasoning tier" value={w.tier} mono />
        <Field
          label="Tools"
          value={
            w.tools && w.tools.length > 0
              ? w.tools.join(", ")
              : w.tools
                ? "(none granted)"
                : undefined
          }
          mono
        />
        <Field
          label="Computer required"
          value={
            w.computerRequired === undefined
              ? undefined
              : w.computerRequired
                ? "yes"
                : "no"
          }
        />
        <Field
          label="Capability needs"
          value={
            w.needs && w.needs.length > 0 ? w.needs.join(", ") : undefined
          }
        />
        <Field
          label="Steps"
          value={w.stepCount !== undefined ? String(w.stepCount) : undefined}
        />
        <Field
          label="Last action"
          value={w.lastAction}
          mono
          tone={
            w.lastActionOk === false
              ? "warning"
              : w.lastActionOk === true
                ? "success"
                : undefined
          }
        />
        <Field
          label="Last retry reason"
          value={w.lastRetryReason}
          tone="warning"
        />
        <Field
          label="Terminal summary"
          value={w.terminalSummary}
          tone={terminal === "success" ? "success" : terminal === "failure" ? "danger" : undefined}
        />
        {w.firstSeenAt && (
          <p className="text-[10px] text-muted-foreground">
            First seen {new Date(w.firstSeenAt).toLocaleTimeString()}
            {w.lastObservedAt && (
              <> · last event {new Date(w.lastObservedAt).toLocaleTimeString()}</>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: string | undefined;
  mono?: boolean;
  tone?: "success" | "warning" | "danger";
}) {
  if (value === undefined) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground w-28 shrink-0 text-[10px] uppercase tracking-wide">
          {label}
        </span>
        <span className="text-muted-foreground/60 italic text-[11px]">
          Not provided
        </span>
      </div>
    );
  }
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground w-28 shrink-0 text-[10px] uppercase tracking-wide">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 break-words",
          mono && "font-mono text-[11px]",
          toneClass,
        )}
      >
        {value}
      </span>
    </div>
  );
}

// Re-export for parent.
export { AlertTriangle };
