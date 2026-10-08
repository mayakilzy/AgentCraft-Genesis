"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import type { MissionStatus } from "@/lib/genesis/types";
import { cn } from "@/lib/utils";

interface CancelFlowProps {
  missionId: string;
  currentStatus: MissionStatus | undefined;
  terminal: boolean;
  onCancelled?: () => void;
}

type CancelState =
  | "idle"
  | "confirming"
  | "submitting"
  | "requested"
  | "cancelled"
  | "succeeded-anyway"
  | "failed-anyway"
  | "error";

/**
 * CancelFlow — the cancel mission control.
 *
 * Per 03_UI_UX_CONTRACT §Mission Control behavior contract:
 *   - Cancel action: confirm → request → pending → acknowledged/rejected.
 *   - Cancellation does not mean immediate worker termination.
 *   - Do not show CANCELLED until server confirms.
 *   - Cancellation REQUEST != CANCELLATION COMPLETE.
 *
 * The flow:
 *   1. User clicks "Cancel mission" → AlertDialog opens (state=confirming).
 *   2. User confirms → POST /v1/missions/{id}/cancel (state=submitting).
 *   3. Server returns 202 with { status, cancelRequested: true } (state=requested).
 *   4. UI polls the snapshot (handled by parent) until status=CANCELLED or
 *      SUCCEEDED/PARTIAL (race). Until then, shows "Cancellation requested,
 *      awaiting server confirmation".
 *   5. When snapshot becomes terminal:
 *      - CANCELLED → state=cancelled (success message)
 *      - SUCCEEDED/PARTIAL → state=succeeded-anyway (honest: cancellation
 *        raced; the mission finished before the abort signal landed)
 *      - FAILED → state=failed-anyway (same race pattern)
 *
 * Repeated cancel is safe: the gateway's cancel endpoint is idempotent
 * (returns the same status). The button is disabled while submitting.
 */
export function CancelFlow({
  missionId,
  currentStatus,
  terminal,
  onCancelled,
}: CancelFlowProps) {
  const [state, setState] = useState<CancelState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // When the mission reaches terminal state, transition the cancel UI.
    // This is a legitimate state-sync pattern: the local `state` tracks the
    // cancel flow's progress; the parent's snapshot drives the terminal
    // transition. Cascading render is bounded (one render per terminal
    // transition).
    if (!terminal || state === "idle" || state === "confirming") return;
    if (state === "submitting" || state === "requested") {
      if (currentStatus === "CANCELLED") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState("cancelled");
      } else if (currentStatus === "SUCCEEDED" || currentStatus === "PARTIAL") {
         
        setState("succeeded-anyway");
      } else if (currentStatus === "FAILED") {
         
        setState("failed-anyway");
      }
    }
  }, [terminal, currentStatus, state]);

  // Reset state when missionId changes. setState in effect is the cleanest
  // way to sync local state to a prop change without a key remount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState("idle");
     
    setErrorMsg(undefined);
  }, [missionId]);

  const doCancel = async () => {
    setState("submitting");
    setErrorMsg(undefined);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await genesisApi.cancelMission(missionId, controller.signal);
      if (res.kind === "ok" && res.data) {
        setState("requested");
      } else if (res.kind === "unauthorized") {
        setState("error");
        setErrorMsg(
          "Authentication failed. The BFF session may have expired; refresh the page.",
        );
      } else if (res.kind === "unavailable") {
        setState("error");
        setErrorMsg(
          "Gateway unreachable. The cancellation request was not delivered.",
        );
      } else {
        // 404 MISSION_NOT_FOUND or 5xx
        setState("error");
        setErrorMsg(
          res.message ?? `Cancellation failed (status ${res.status ?? "?"}).`,
        );
      }
    } catch (e) {
      setState("error");
      setErrorMsg(e instanceof Error ? e.message : "Network error.");
    }
  };

  // Don't render anything if the mission is already terminal (no cancel possible).
  if (terminal) {
    if (state === "cancelled" || currentStatus === "CANCELLED") {
      return (
        <div className="rounded-md border border-muted bg-muted/30 p-2 text-xs text-muted-foreground flex items-center gap-1.5">
          <Ban className="size-3.5" aria-hidden="true" />
          Mission cancelled.
        </div>
      );
    }
    if (state === "succeeded-anyway" || state === "failed-anyway") {
      return (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning flex items-center gap-1.5">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Cancellation raced — mission finished with status{" "}
          <strong>{currentStatus}</strong> before the abort signal landed.
        </div>
      );
    }
    // Terminal but no cancel was attempted — no UI to show.
    return null;
  }

  return (
    <div className="space-y-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={state === "submitting" || state === "requested"}
            className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {state === "submitting" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : state === "requested" ? (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            ) : (
              <Ban className="size-3.5" aria-hidden="true" />
            )}
            {state === "submitting"
              ? "Submitting…"
              : state === "requested"
                ? "Cancellation requested…"
                : "Cancel mission"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this mission?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends a cancellation request to the gateway. Cancellation
              does NOT mean immediate worker termination — in-flight actions
              may continue briefly. The mission status will show{" "}
              <code className="font-mono text-xs">CANCELLATION_REQUESTED</code>{" "}
              until the orchestrator unwinds, then{" "}
              <code className="font-mono text-xs">CANCELLED</code>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void doCancel()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, cancel mission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {state === "requested" && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning flex items-start gap-1.5"
        >
          <RefreshCw className="size-3.5 shrink-0 mt-0.5 animate-spin" aria-hidden="true" />
          <div>
            <p className="font-medium">Cancellation requested.</p>
            <p className="text-[11px]">
              The gateway acknowledged the request. The orchestrator is
              unwinding. Mission status will transition to{" "}
              <code className="font-mono">CANCELLED</code> once cleanup
              completes — or to a terminal state if the mission finished
              before the abort signal landed (race).
            </p>
          </div>
        </div>
      )}

      {state === "error" && errorMsg && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive flex items-start gap-1.5"
        >
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-medium">Cancellation failed.</p>
            <p className="text-[11px]">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
