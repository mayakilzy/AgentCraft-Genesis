"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Send,
  Undo2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import { cn } from "@/lib/utils";

// Conservative client-side cap. The gateway allows up to 1MB total body, but a
// goal's `outcome` should never be that long. 50KB is generous and well below
// the gateway limit even when combined with context + constraints.
const MAX_OUTCOME_CHARS = 50_000;
const MAX_CONTEXT_CHARS = 20_000;
const MAX_CONSTRAINTS_CHARS = 5_000;

/**
 * Generate a UUID v4 for use as idempotencyKey. Uses crypto.randomUUID when
 * available (modern browsers); falls back to Math.random-based construction.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "idk-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface ValidationIssue {
  field: "outcome" | "context" | "constraints";
  message: string;
}

function validate(
  outcome: string,
  context: string,
  constraintsRaw: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const trimmedOutcome = outcome.trim();
  if (trimmedOutcome.length === 0) {
    issues.push({
      field: "outcome",
      message: "Goal text is required. State the desired outcome in one or two sentences.",
    });
  } else if (outcome.length > MAX_OUTCOME_CHARS) {
    issues.push({
      field: "outcome",
      message: `Goal exceeds the ${MAX_OUTCOME_CHARS.toLocaleString()}-character client cap. Trim or split the goal.`,
    });
  }
  if (context.length > MAX_CONTEXT_CHARS) {
    issues.push({
      field: "context",
      message: `Context exceeds the ${MAX_CONTEXT_CHARS.toLocaleString()}-character cap.`,
    });
  }
  if (constraintsRaw.length > MAX_CONSTRAINTS_CHARS) {
    issues.push({
      field: "constraints",
      message: `Constraints exceed the ${MAX_CONSTRAINTS_CHARS.toLocaleString()}-character cap.`,
    });
  }
  return issues;
}

/**
 * GoalComposer — the goal-first composer for Work section.
 *
 * Per 02_PRODUCT_SPECIFICATION §Golden journey step 2: "User enters goal,
 * optional constraints and references, and desired success criteria. Validate
 * before submission."
 *
 * Per 03_UI_UX_CONTRACT §Work behavior contract:
 *   - Goal input required; empty/whitespace rejected.
 *   - Max length derived from actual API schema; conservative client cap.
 *   - Constraints/success criteria optional only if backend accepts them.
 *   - Submit: idle → validating → submitting → acknowledged(id) / rejected(error)
 *     / uncertain(network failure).
 *   - If acknowledgement lost, never blindly retry non-idempotent operation;
 *     offer lookup by correlation/idempotency if supported.
 *
 * Per operator directive (G7-02): NEVER display a successful mission
 * submission before the Gateway returns its acknowledgement (202 with
 * missionId).
 */
export function GoalComposer() {
  const [outcome, setOutcome] = useState("");
  const [context, setContext] = useState("");
  const [constraintsRaw, setConstraintsRaw] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const submissionState = useGenesisStore((s) => s.submissionState);
  const setSubmissionState = useGenesisStore((s) => s.setSubmissionState);
  const pendingIdempotencyKey = useGenesisStore(
    (s) => s.pendingIdempotencyKey,
  );
  const pendingGoalText = useGenesisStore((s) => s.pendingGoalText);
  const upsertKnownMission = useGenesisStore((s) => s.upsertKnownMission);
  const setActiveMissionId = useGenesisStore((s) => s.setActiveMissionId);
  const setActiveSection = useGenesisStore((s) => s.setActiveSection);
  const connectionState = useGenesisStore((s) => s.connectionState);

  const issues = useMemo(
    () => validate(outcome, context, constraintsRaw),
    [outcome, context, constraintsRaw],
  );

  const abortRef = useRef<AbortController | null>(null);

  // Clean up any in-flight submission on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const isSubmitting = submissionState === "submitting";
  const isValidating = submissionState === "validating";
  const isAcked = submissionState === "acknowledged";
  const isRejected = submissionState === "rejected";
  const isUncertain = submissionState === "uncertain";
  const submissionError = useGenesisStore((s) => s.submissionError);
  const submissionErrorCode = useGenesisStore((s) => s.submissionErrorCode);
  const lastSubmittedMissionId = useGenesisStore(
    (s) => s.lastSubmittedMissionId,
  );

  const handleSubmit = async () => {
    if (isSubmitting || isValidating) return;

    // 1. Validate client-side.
    setSubmissionState("validating");
    if (issues.length > 0) {
      setSubmissionState("rejected", {
        submissionError: issues[0].message,
        submissionErrorCode: "INVALID_SUBMISSION",
      });
      return;
    }

    // 2. Build submission. Generate idempotencyKey for safe retry.
    const idempotencyKey = newIdempotencyKey();
    const constraints = constraintsRaw
      .split("\n")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    setSubmissionState("submitting", {
      pendingIdempotencyKey: idempotencyKey,
      pendingGoalText: outcome,
      submissionError: undefined,
      submissionErrorCode: undefined,
    });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const res = await genesisApi.submitMission(
      {
        outcome: outcome.trim(),
        context: context.trim() || undefined,
        constraints: constraints.length > 0 ? constraints : undefined,
        idempotencyKey,
        label: "g7-ui",
      },
      controller.signal,
    );

    if (res.kind === "ok" && res.data) {
      // 3. Acknowledged — capture server-canonical mission ID. NEVER before this.
      const { missionId } = res.data;
      setSubmissionState("acknowledged", {
        lastSubmittedMissionId: missionId,
        pendingIdempotencyKey: undefined,
        pendingGoalText: undefined,
      });
      upsertKnownMission({
        missionId,
        firstSeenAt: new Date().toISOString(),
        source: "submit",
      });
      // Auto-navigate to Mission Control after a short delay (let the user see the ack).
      setTimeout(() => {
        setActiveMissionId(missionId);
        setActiveSection("mission-control");
      }, 600);
      return;
    }

    if (res.kind === "uncertain") {
      // 4. Network failure after submit — show UNCERTAIN. Never blind retry.
      setSubmissionState("uncertain", {
        submissionError:
          "Action submitted; final result not yet confirmed. The gateway may have received the goal, but the acknowledgement was lost. Use Retry to attempt the same submission (the idempotency key is preserved).",
        submissionErrorCode: "UNCERTAIN",
      });
      return;
    }

    if (res.kind === "unauthorized") {
      setSubmissionState("rejected", {
        submissionError:
          res.code === "FORBIDDEN"
            ? "The gateway refused this submission. Your caller identity is not permitted to submit missions."
            : "Authentication failed. The BFF session may have expired; refresh the page.",
        submissionErrorCode: res.code ?? "UNAUTHENTICATED",
      });
      return;
    }

    if (res.kind === "unavailable") {
      // Gateway down. Per negative control: NO successful submission banner.
      setSubmissionState("rejected", {
        submissionError:
          "Gateway unreachable. The submission was not delivered. Retry when the gateway is back online.",
        submissionErrorCode: "UNAVAILABLE",
      });
      return;
    }

    // Error path with a server-returned code.
    const code = res.code ?? "INTERNAL_ERROR";
    let userMessage: string;
    switch (code) {
      case "INVALID_JSON":
        userMessage = "The submission body was malformed. This is a UI bug — please report.";
        break;
      case "INVALID_SUBMISSION":
        userMessage =
          "The gateway rejected the submission. Ensure the goal text is non-empty.";
        break;
      case "ADMISSION_DENIED":
        userMessage =
          "The gateway denied admission. You may have reached the maximum active missions limit. Wait for an active mission to finish or contact the operator.";
        break;
      case "INTERNAL_ERROR":
        userMessage =
          "The gateway reported an internal error. The submission may or may not have been received. Retry with the same goal (idempotency key is preserved).";
        break;
      default:
        userMessage = res.message ?? "Submission failed with an unknown error.";
    }
    setSubmissionState("rejected", {
      submissionError: userMessage,
      submissionErrorCode: code,
    });
  };

  const handleRetry = async () => {
    // Retry using the SAME idempotencyKey — if the gateway received the
    // original, it returns the same missionId instead of creating new work.
    if (!pendingIdempotencyKey || !pendingGoalText) {
      // Cannot safely retry without the key. Reset to idle; user re-enters.
      setSubmissionState("idle");
      return;
    }
    setOutcome(pendingGoalText);
    setSubmissionState("submitting", {
      submissionError: undefined,
      submissionErrorCode: undefined,
    });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const constraints = constraintsRaw
      .split("\n")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const res = await genesisApi.submitMission(
      {
        outcome: pendingGoalText.trim(),
        context: context.trim() || undefined,
        constraints: constraints.length > 0 ? constraints : undefined,
        idempotencyKey: pendingIdempotencyKey,
        label: "g7-ui-retry",
      },
      controller.signal,
    );

    if (res.kind === "ok" && res.data) {
      const { missionId } = res.data;
      setSubmissionState("acknowledged", {
        lastSubmittedMissionId: missionId,
        pendingIdempotencyKey: undefined,
        pendingGoalText: undefined,
      });
      upsertKnownMission({
        missionId,
        firstSeenAt: new Date().toISOString(),
        source: "submit",
      });
      setTimeout(() => {
        setActiveMissionId(missionId);
        setActiveSection("mission-control");
      }, 600);
    } else if (res.kind === "uncertain" || res.kind === "unavailable") {
      setSubmissionState("uncertain", {
        submissionError:
          "Retry result is also uncertain. The gateway is still unreachable. Try again later.",
      });
    } else {
      setSubmissionState("rejected", {
        submissionError:
          res.message ?? "Retry failed.",
        submissionErrorCode: res.code,
      });
    }
  };

  const handleReset = () => {
    setOutcome("");
    setContext("");
    setConstraintsRaw("");
    setSubmissionState("idle", {
      pendingIdempotencyKey: undefined,
      pendingGoalText: undefined,
      submissionError: undefined,
      submissionErrorCode: undefined,
    });
  };

  // Disable submit when gateway is disconnected (negative control: no
  // successful submission banner when gateway is down).
  const gatewayDown =
    connectionState === "disconnected" || connectionState === "failed";
  const submitDisabled =
    isSubmitting ||
    isValidating ||
    gatewayDown ||
    issues.some((i) => i.field === "outcome" && i.message.includes("exceeds"));

  // Outcome issues take precedence for the inline message.
  const outcomeIssue = issues.find((i) => i.field === "outcome");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="goal-outcome" className="text-sm font-medium">
          Goal <span className="text-destructive">*</span>
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({outcome.length.toLocaleString()}/{MAX_OUTCOME_CHARS.toLocaleString()})
          </span>
        </Label>
        <Textarea
          id="goal-outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          placeholder="Describe the desired outcome. e.g., 'Write a markdown file named output.md at the workspace root with a single H1 heading.'"
          rows={4}
          maxLength={MAX_OUTCOME_CHARS + 100}
          aria-required="true"
          aria-invalid={outcomeIssue ? "true" : undefined}
          aria-describedby={outcomeIssue ? "goal-outcome-error" : undefined}
          disabled={isSubmitting || isValidating || isAcked}
          className="resize-y scrollbar-clean"
        />
        {outcomeIssue && (
          <p
            id="goal-outcome-error"
            role="alert"
            aria-live="assertive"
            className="text-xs text-destructive"
          >
            {outcomeIssue.message}
          </p>
        )}
      </div>

      {/* Advanced options — collapsible to keep the composer focused on the goal. */}
      <details
        className="rounded-md border border-border bg-card/50 p-3"
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
        open={showAdvanced}
      >
        <summary className="cursor-pointer text-sm font-medium select-none">
          Optional context, constraints, and budget hint
        </summary>
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="goal-context" className="text-xs font-medium">
              Context (optional background the gateway carries into requirements)
            </Label>
            <Textarea
              id="goal-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g., 'This is for a documentation site; assume Markdown readers.'"
              rows={2}
              maxLength={MAX_CONTEXT_CHARS + 100}
              disabled={isSubmitting || isValidating || isAcked}
              className="resize-y scrollbar-clean text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-constraints" className="text-xs font-medium">
              Constraints (one per line)
            </Label>
            <Textarea
              id="goal-constraints"
              value={constraintsRaw}
              onChange={(e) => setConstraintsRaw(e.target.value)}
              placeholder={"e.g.,\nmust run offline\nno external API calls"}
              rows={3}
              maxLength={MAX_CONSTRAINTS_CHARS + 100}
              disabled={isSubmitting || isValidating || isAcked}
              className="resize-y scrollbar-clean text-sm font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Constraints are echoed from the goal plus domain invariants by the
              gateway. Success criteria are synthesized by the goal compiler;
              they are NOT a direct UI input.
            </p>
          </div>
        </div>
      </details>

      {/* Submission state surface — honest at every step. */}
      {isAcked && lastSubmittedMissionId && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success"
        >
          <CheckCircle2 className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">Mission acknowledged by the gateway.</p>
            <p className="font-mono text-xs">
              missionId: {lastSubmittedMissionId}
            </p>
            <p className="text-xs text-muted-foreground">
              The gateway returned its canonical mission ID. Navigating to
              Mission Control…
            </p>
          </div>
        </div>
      )}

      {isUncertain && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
        >
          <CircleAlert className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">Submission uncertain.</p>
            <p className="text-xs">{submissionError}</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              idempotencyKey: {pendingIdempotencyKey}
            </p>
          </div>
        </div>
      )}

      {isRejected && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">Submission rejected.</p>
            <p className="text-xs">{submissionError}</p>
            {submissionErrorCode && (
              <p className="font-mono text-[10px] text-muted-foreground">
                code: {submissionErrorCode}
              </p>
            )}
          </div>
        </div>
      )}

      {gatewayDown && !isAcked && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-border bg-muted/50 p-2 text-xs text-muted-foreground"
        >
          Gateway is unreachable. The submit button is disabled — no submission
          can be made until the gateway is back online.
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-2">
        {isUncertain ? (
          <Button
            type="button"
            onClick={() => void handleRetry()}
            disabled={isSubmitting}
            className="gap-1.5"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry with same idempotency key
          </Button>
        ) : isAcked ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            className="gap-1.5"
          >
            <Undo2 className="size-4" aria-hidden="true" />
            Compose another goal
          </Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={submitDisabled}
                  aria-keyshortcuts="Control+Enter"
                  className="gap-1.5"
                >
                  {isSubmitting || isValidating ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="size-4" aria-hidden="true" />
                  )}
                  {isSubmitting
                    ? "Submitting…"
                    : isValidating
                      ? "Validating…"
                      : "Submit goal"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {gatewayDown
                  ? "Gateway unreachable — submit disabled"
                  : "Submit goal to the gateway (Ctrl+Enter)"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {!isAcked && !isUncertain && !isSubmitting && !isValidating && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={!outcome && !context && !constraintsRaw}
            className="text-muted-foreground"
          >
            Clear
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Submission goes through a server-side BFF proxy. The gateway API key is
        never exposed to your browser. A client-generated idempotency key
        enables safe retry if the acknowledgement is lost.
      </p>
    </div>
  );
}
