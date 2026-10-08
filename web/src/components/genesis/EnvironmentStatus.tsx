"use client";

import { FlaskConical, ShieldAlert } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGenesisStore } from "@/lib/genesis/store";
import { cn } from "@/lib/utils";

/**
 * EnvironmentStatus — permanent visible banner for the controlled-test mode.
 *
 * Per 01_MASTER_GLM_EXECUTION_PROMPT §Rules: "Implement controlled-demo mode
 * behind explicit nonproduction flag with permanent visible label. Never fall
 * back silently from live to demo."
 *
 * Per 10_OPERATOR_DECISIONS: GLM may be used for development and controlled
 * reasoning substitution; this is NOT evidence of live ZAI/OpenBot integration.
 *
 * The banner is permanent when genesisMode === 'controlled'. Switching to 'live'
 * requires NEXT_PUBLIC_GENESIS_MODE=live AND a production-mode gateway (verified
 * separately by inspecting health.limitations).
 */
export function EnvironmentStatus() {
  const mode = useGenesisStore((s) => s.genesisMode);
  const isControlled = mode !== "live";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="status"
            aria-live="polite"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
              isControlled
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-success/40 bg-success/10 text-success",
            )}
          >
            {isControlled ? (
              <FlaskConical className="size-3.5" aria-hidden="true" />
            ) : (
              <ShieldAlert className="size-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {isControlled ? "Controlled test" : "Live environment"}
            </span>
            <span className="sm:hidden" aria-hidden="true">
              {isControlled ? "TEST" : "LIVE"}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px]">
          <div className="space-y-1 text-xs">
            <div className="font-semibold">
              {isControlled
                ? "Controlled test environment"
                : "Live environment"}
            </div>
            {isControlled ? (
              <>
                <div>
                  Not a live production provider. Real ZAI/OpenBot integration is
                  not claimed.
                </div>
                <div>
                  Evidence tier labels (E0/E1/E2/E3) appear on every artifact /
                  event / metric.
                </div>
              </>
            ) : (
              <div>
                Production execution mode. The gateway is configured with real
                reasoning and runtime providers.
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Full-width banner variant — shown permanently above the main content when
 * in controlled mode. Per 03_UI_UX_CONTRACT §Failure and boundary copy:
 *   "This is a controlled test environment, not a live production provider."
 */
export function EnvironmentBanner() {
  const mode = useGenesisStore((s) => s.genesisMode);
  if (mode === "live") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning"
    >
      <strong>Controlled test environment</strong> — not a live production
      provider. Real ZAI/OpenBot integration is not claimed. Evidence tier
      labels (E0/E1/E2/E3) appear on every artifact, event, and metric.
    </div>
  );
}
