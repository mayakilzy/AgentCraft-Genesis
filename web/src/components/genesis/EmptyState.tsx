"use client";

import { useEffect } from "react";
import { AlertTriangle, Inbox, Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGenesisStore } from "@/lib/genesis/store";
import { cn } from "@/lib/utils";

type State = "loading" | "loaded" | "empty" | "error" | "disconnected";

interface StateConfig {
  icon: typeof Inbox;
  title: string;
  description: string;
  className: string;
}

const CONFIG: Record<State, StateConfig> = {
  loading: {
    icon: Loader2,
    title: "Loading…",
    description: "Awaiting server response.",
    className: "text-muted-foreground",
  },
  loaded: {
    icon: Inbox,
    title: "",
    description: "",
    className: "",
  },
  empty: {
    icon: Inbox,
    title: "Nothing here yet",
    description: "No data is available for this view.",
    className: "text-muted-foreground",
  },
  error: {
    icon: AlertTriangle,
    title: "Could not load this view",
    description:
      "An error was returned by the gateway. The error has been logged locally with a correlation ID — no analytics are sent.",
    className: "text-destructive",
  },
  disconnected: {
    icon: WifiOff,
    title: "Gateway unreachable",
    description:
      "Connection lost — showing last observed state where applicable. The gateway may be down or your session may have lost network.",
    className: "text-muted-foreground",
  },
};

/**
 * EmptyState — honest empty/error/disconnected surface.
 *
 * Per 03_UI_UX_CONTRACT §Global invariants: every screen has loading/loaded/
 * empty/error/disconnected states. Per §Visual language: red reserved for
 * confirmed errors. Per §Failure and boundary copy: "Connection lost — showing
 * last observed state."
 */
export function EmptyState({
  state,
  onRetry,
  customDescription,
  className,
  children,
}: {
  state: State;
  onRetry?: () => void;
  customDescription?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const connectionState = useGenesisStore((s) => s.connectionState);
  // Auto-display disconnected variant if the global connection state is disconnected.
  const effective: State =
    state === "error" && connectionState === "disconnected"
      ? "disconnected"
      : state;
  const c = CONFIG[effective];
  const Icon = c.icon;

  // Live region — announce to assistive tech without overwhelming.
  useEffect(() => {
    // No-op; we rely on aria-live on the parent.
  }, [effective]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/50 p-8 text-center",
        className,
      )}
    >
      <Icon
        className={cn(
          "size-8",
          effective === "loading" && "animate-spin",
          c.className,
        )}
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className={cn("text-sm font-medium", c.className)}>{c.title}</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          {customDescription ?? c.description}
        </p>
      </div>
      {children}
      {(effective === "error" || effective === "disconnected") && onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-1"
        >
          Retry
        </Button>
      )}
    </div>
  );
}

/**
 * LoadingSkeleton — shimmer placeholder for cards/lists.
 */
export function LoadingSkeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("space-y-2", className)}
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton-shimmer h-12 w-full rounded-md"
          aria-hidden="true"
        />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
