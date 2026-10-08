"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Inbox, Search, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { EmptyState } from "@/components/genesis/EmptyState";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import type { MissionSnapshot } from "@/lib/genesis/types";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, { className: string; label: string }> = {
  ACCEPTED: { className: "bg-muted text-muted-foreground border-border", label: "Accepted" },
  RUNNING: { className: "bg-primary/10 text-primary border-primary/30", label: "Running" },
  SUCCEEDED: { className: "bg-success/15 text-success border-success/30", label: "Succeeded" },
  FAILED: { className: "bg-destructive/15 text-destructive border-destructive/30", label: "Failed" },
  PARTIAL: { className: "bg-warning/15 text-warning border-warning/30", label: "Partial" },
  CANCELLATION_REQUESTED: { className: "bg-warning/15 text-warning border-warning/30", label: "Cancelling" },
  CANCELLED: { className: "bg-muted text-muted-foreground border-border", label: "Cancelled" },
  UNKNOWN: { className: "bg-muted text-muted-foreground border-border", label: "Unknown" },
};

/**
 * MissionList — shows missions known to THIS browser session only.
 *
 * Per 02_PRODUCT_SPECIFICATION §Work §Mission list: "filter/search by
 * server-supported fields or local loaded data, clear pagination/limits, honest
 * empty/error/loading states. Do not promise persistence across restart without
 * proof."
 *
 * Per G7-01 capability matrix: list_missions is ABSENT in the gateway
 * (verified by source inspection). The UI MUST label this as browser-local,
 * NOT server-authoritative.
 *
 * Missions are added to this list when:
 *   - The user submits a goal and the gateway returns 202 with a missionId.
 *   - The user looks up a mission by ID via MissionLookup.
 */
export function MissionList() {
  const knownMissions = useGenesisStore((s) => s.knownMissions);
  const setActiveMissionId = useGenesisStore((s) => s.setActiveMissionId);
  const setActiveSection = useGenesisStore((s) => s.setActiveSection);

  const entries = Object.values(knownMissions).sort((a, b) =>
    b.firstSeenAt.localeCompare(a.firstSeenAt),
  );

  if (entries.length === 0) {
    return (
      <EmptyState
        state="empty"
        customDescription="No missions known to this browser session yet. Submit a goal above, or look up a known mission ID below. The gateway has no list endpoint, so missions appear here only after you submit or look them up."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
        <strong>Honest notice:</strong> The gateway does not expose a list
        endpoint. These missions are known to this browser session only — they
        are not server-authoritative history. If the gateway restarts, all
        in-flight state is lost (including missions shown here).
      </div>
      {entries.map((m) => {
        const status = m.lastSnapshot?.status ?? "UNKNOWN";
        const tone = STATUS_TONE[status] ?? STATUS_TONE.UNKNOWN;
        return (
          <button
            key={m.missionId}
            type="button"
            onClick={() => {
              setActiveMissionId(m.missionId);
              setActiveSection("mission-control");
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left",
              "transition-colors hover:bg-accent",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
            )}
            aria-label={`Open mission ${m.missionId.slice(0, 8)} in Mission Control. Status: ${tone.label}.`}
          >
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium",
                tone.className,
              )}
            >
              {tone.label}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="truncate font-mono text-xs">
                {m.missionId}
              </p>
              <p className="text-[11px] text-muted-foreground">
                First seen {new Date(m.firstSeenAt).toLocaleString()} ·{" "}
                {m.source === "submit" ? "submitted" : "looked up"}
                {m.lastObservedAt
                  ? ` · last observed ${new Date(m.lastObservedAt).toLocaleTimeString()}`
                  : ""}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * MissionLookup — resolve a known mission ID by manual entry.
 *
 * Per 02_PRODUCT_SPECIFICATION §Work §Mission list: "If list unavailable,
 * support known-ID lookup and label limitation; never invent history."
 *
 * Per the gateway contract (G7-01 capability matrix): GET /v1/missions/{id}
 * returns 200 with MissionSnapshot, 404 if not found OR not owned by caller
 * (intentional ambiguity). UI maps both to "not found or not yours" honestly.
 */
export function MissionLookup() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState<string | undefined>();
  const upsertKnownMission = useGenesisStore((s) => s.upsertKnownMission);
  const knownMissions = useGenesisStore((s) => s.knownMissions);
  const setActiveMissionId = useGenesisStore((s) => s.setActiveMissionId);
  const setActiveSection = useGenesisStore((s) => s.setActiveSection);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const lookup = async () => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setState("error");
      setError("Enter a mission ID to look up.");
      return;
    }
    setState("loading");
    setError(undefined);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const res = await genesisApi.getMission(trimmed, controller.signal);

    if (res.kind === "ok" && res.data) {
      const snap = res.data as MissionSnapshot;
      setState("ok");
      upsertKnownMission({
        missionId: snap.missionId,
        firstSeenAt:
          knownMissions[snap.missionId]?.firstSeenAt ??
          new Date().toISOString(),
        lastSnapshot: snap,
        lastObservedAt: new Date().toISOString(),
        source: "lookup",
      });
      setActiveMissionId(snap.missionId);
      setActiveSection("mission-control");
      return;
    }

    setState("error");
    if (res.kind === "unauthorized") {
      setError(
        "Authentication failed. The BFF session may have expired; refresh the page.",
      );
    } else if (res.kind === "unavailable") {
      setError(
        "Gateway unreachable. Cannot look up the mission. Try when the gateway is back online.",
      );
    } else if (res.code === "MISSION_NOT_FOUND") {
      setError(
        "Mission not found — or it is not owned by this caller. The gateway returns 404 in both cases (intentional ambiguity) to avoid leaking the existence of other callers' missions.",
      );
    } else if (res.code === "ADMISSION_DENIED") {
      setError("Rate limit reached. Wait a moment and try again.");
    } else {
      setError(res.message ?? "Lookup failed.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Look up a mission by ID</CardTitle>
        <CardDescription className="text-xs">
          If you know the server-canonical mission ID (e.g., from a previous
          submission), enter it here to open the mission in Mission Control.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && state !== "loading") {
                e.preventDefault();
                void lookup();
              }
            }}
            placeholder="e.g., 7c8b9a1d-..."
            aria-label="Mission ID to look up"
            aria-invalid={state === "error" ? "true" : undefined}
            aria-describedby={error ? "mission-lookup-error" : undefined}
            disabled={state === "loading"}
            className="font-mono text-sm"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void lookup()}
            disabled={state === "loading" || query.trim().length === 0}
            className="gap-1.5"
          >
            {state === "loading" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Look up</span>
          </Button>
        </div>
        {state === "error" && error && (
          <p
            id="mission-lookup-error"
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-1.5 text-xs text-destructive"
          >
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
        {state === "ok" && (
          <p
            role="status"
            aria-live="polite"
            className="text-xs text-success"
          >
            Mission resolved. Navigating to Mission Control…
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Re-export Inbox icon for callers.
export { Inbox };
