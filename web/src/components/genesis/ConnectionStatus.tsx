"use client";

import { useEffect, useRef } from "react";
import { RefreshCw, WifiOff, Wifi, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import { cn } from "@/lib/utils";

/**
 * ConnectionStatus — verifies the gateway is reachable via /health.
 *
 * Per 03_UI_UX_CONTRACT §Global invariants: every screen has five explicit
 * states including "disconnected/stale". Per 04_GATEWAY_DISCOVERY §Event contract,
 * connectionState is kept SEPARATE from mission status.
 *
 * G7-01-F-002: /health returns 'ok' even in dev mode. We inspect
 * health.limitations to determine if the gateway is running dev-mode fixtures
 * (MemoryComputer + DEVELOPMENT_REASONING_FALLBACK) — if so, we visually
 * downgrade from "live" to "stale" (controlled-test indicator).
 */
export function ConnectionStatus() {
  const connectionState = useGenesisStore((s) => s.connectionState);
  const setConnectionState = useGenesisStore((s) => s.setConnectionState);
  const setLastConnectionCheckAt = useGenesisStore(
    (s) => s.setLastConnectionCheckAt,
  );
  const abortRef = useRef<AbortController | null>(null);

  const checkHealth = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setConnectionState("connecting");
    setLastConnectionCheckAt(new Date().toISOString());
    const res = await genesisApi.health(controller.signal);
    if (res.kind === "ok" && res.data) {
      const isControlled = res.data.limitations?.some((l) =>
        /deterministic reasoning default|memory filesystem default/i.test(l),
      );
      // If the gateway is in dev mode, we still mark "live" but the
      // EnvironmentStatus will surface the dev-mode banner separately.
      // The connection state itself just means "gateway reachable".
      setConnectionState(isControlled ? "stale" : "live");
    } else if (res.kind === "unauthorized") {
      setConnectionState("failed");
    } else if (res.kind === "unavailable") {
      setConnectionState("disconnected");
    } else {
      setConnectionState("disconnected");
    }
  };

  useEffect(() => {
    void checkHealth();
    // Poll every 15s for connection liveness (bounded; per 05_SECURITY §Resilience).
    const interval = setInterval(() => void checkHealth(), 15_000);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, []);

  const config: Record<
    typeof connectionState,
    { icon: typeof Wifi; label: string; className: string; tone: string }
  > = {
    connecting: {
      icon: Loader2,
      label: "Connecting…",
      className: "bg-muted text-muted-foreground",
      tone: "border-border",
    },
    live: {
      icon: Wifi,
      label: "Connected",
      className: "bg-success/15 text-success",
      tone: "border-success/30",
    },
    stale: {
      icon: Wifi,
      label: "Connected (controlled)",
      className: "bg-warning/15 text-warning",
      tone: "border-warning/30",
    },
    disconnected: {
      icon: WifiOff,
      label: "Disconnected",
      className: "bg-muted text-muted-foreground",
      tone: "border-border",
    },
    failed: {
      icon: AlertCircle,
      label: "Unauthorized",
      className: "bg-destructive/15 text-destructive",
      tone: "border-destructive/30",
    },
  };
  const c = config[connectionState];
  const Icon = c.icon;
  const isConnecting = connectionState === "connecting";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void checkHealth()}
            aria-label={`Gateway connection: ${c.label}. Click to retry.`}
            aria-live="polite"
            className={cn(
              "h-8 gap-1.5 border text-xs font-medium",
              c.className,
              c.tone,
            )}
          >
            <Icon
              className={cn("size-3.5", isConnecting && "animate-spin")}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">{c.label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <div>State: <strong>{connectionState}</strong></div>
            <div>Click to retry /health probe.</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
