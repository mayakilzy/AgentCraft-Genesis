"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FileText, HelpCircle, Inbox, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import type { MissionArtifactRecord } from "@/lib/genesis/types";
import {
  missionVerificationState,
  VERIFICATION_META,
  verificationStateFromArtifact,
  sanitizeDownloadFilename,
} from "@/lib/genesis/artifacts";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<string, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-primary/10 text-primary border-primary/30",
};

const ICON_MAP: Record<string, typeof CheckCircle2> = {
  CheckCircle2,
  XCircle,
  HelpCircle,
  Inbox,
};

interface ArtifactListProps {
  missionId: string;
  /** Called when the user selects an artifact for preview. */
  onSelectArtifact?: (artifact: MissionArtifactRecord) => void;
  /** Currently selected artifact path (for highlighting). */
  selectedPath?: string;
}

/**
 * ArtifactList — fetches /v1/missions/{id}/artifacts and renders one row per
 * artifact with verified/unverified/unknown badge, size, and download button.
 *
 * Per req #1: Verification status originates from the gateway's
 * `artifact.verified` field ONLY. Never inferred.
 * Per req #2: Distinguishes VERIFIED / UNVERIFIED / UNKNOWN / NOT_AVAILABLE.
 * Per req #4: Downloads use the existing authenticated BFF boundary; no
 * public artifact URLs, no Gateway API key exposure.
 */
export function ArtifactList({ missionId, onSelectArtifact, selectedPath }: ArtifactListProps) {
  const [artifacts, setArtifacts] = useState<readonly MissionArtifactRecord[] | null>(null);
  const [state, setState] = useState<"loading" | "loaded" | "error" | "disconnected">("loading");
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    const poll = async () => {
      if (cancelled) return;
      const res = await genesisApi.getArtifacts(missionId, controller.signal);
      if (cancelled) return;
      if (res.kind === "ok" && res.data) {
        setArtifacts(res.data.artifacts);
        setState("loaded");
        setErrorMsg(undefined);
      } else if (res.kind === "unauthorized") {
        setState("error");
        setErrorMsg(
          "Authentication failed. The BFF session may have expired; refresh the page.",
        );
      } else if (res.kind === "unavailable") {
        setState("disconnected");
        setErrorMsg("Gateway unreachable. Cannot list artifacts.");
      } else if (res.code === "MISSION_NOT_FOUND") {
        setState("error");
        setErrorMsg(
          "Mission not found — or it is not owned by this caller. The gateway returns 404 in both cases (intentional ambiguity).",
        );
      } else {
        setState("error");
        setErrorMsg(res.message ?? "Could not load artifacts.");
      }
    };

    void poll();
    // Re-poll every 5s — artifacts don't change frequently, but a mission
    // might still be producing them. Bounded; cleaned up on unmount.
    const interval = setInterval(() => void poll(), 5_000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [missionId]);

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-3">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        <span>Loading artifacts…</span>
      </div>
    );
  }

  if (state === "error" && errorMsg) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
      >
        {errorMsg}
      </div>
    );
  }

  if (state === "disconnected") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning"
      >
        Gateway unreachable — cannot list artifacts. Retry when the gateway is back online.
      </div>
    );
  }

  if (!artifacts || artifacts.length === 0) {
    const meta = VERIFICATION_META.NOT_AVAILABLE;
    const Icon = ICON_MAP[meta.icon] ?? Inbox;
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground space-y-2">
        <Icon className="size-6 mx-auto opacity-50" aria-hidden="true" />
        <p className="font-medium">{meta.label}</p>
        <p>{meta.description}</p>
      </div>
    );
  }

  // Mission-level verification state (NOT inferred from anything but the
  // gateway's artifact.verified fields).
  const missionVerState = missionVerificationState(artifacts);
  const missionMeta = VERIFICATION_META[missionVerState];
  const MissionIcon = ICON_MAP[missionMeta.icon] ?? HelpCircle;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "rounded-md border p-2 text-xs flex items-start gap-2",
          TONE_CLASS[missionMeta.tone],
        )}
        role="status"
        aria-live="polite"
      >
        <MissionIcon className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-medium">Mission verification: {missionMeta.label}</p>
          <p className="text-[11px] opacity-90">{missionMeta.description}</p>
        </div>
      </div>

      <ul className="space-y-1.5">
        {artifacts.map((a, i) => {
          const verState = verificationStateFromArtifact(a.verified);
          const meta = VERIFICATION_META[verState];
          const Icon = ICON_MAP[meta.icon] ?? HelpCircle;
          const isSelected = selectedPath === a.path;
          const canDownload = typeof a.content === "string" && a.content.length > 0;
          const filename = sanitizeDownloadFilename(a.path);
          return (
            <li
              key={`${a.workerId}-${a.path}-${i}`}
              className={cn(
                "rounded-md border bg-card p-2 transition-colors",
                isSelected ? "border-primary" : "border-border",
                "hover:bg-accent",
              )}
            >
              <div className="flex items-start gap-2">
                <FileText className="size-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectArtifact?.(a)}
                      className="font-mono text-xs truncate text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      title={a.path}
                      aria-label={`Preview artifact ${a.path}`}
                    >
                      {a.path}
                    </button>
                    <Badge
                      className={cn(
                        "shrink-0 gap-1",
                        TONE_CLASS[meta.tone],
                      )}
                      aria-label={`Verification: ${meta.label}`}
                    >
                      <Icon className="size-3" aria-hidden="true" />
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>worker: <span className="font-mono">{a.workerId}</span></span>
                    <span>size: {a.bytes} bytes</span>
                    {canDownload ? (
                      <span>content: inline ({a.content?.length ?? 0} chars)</span>
                    ) : (
                      <span className="text-warning">content: not inline (exceeds 64KB or gateway omitted)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onSelectArtifact?.(a)}
                      className="h-7 text-[11px] gap-1"
                      aria-label={`Preview ${filename}`}
                    >
                      Preview
                    </Button>
                    {canDownload ? (
                      <a
                        // Blob download — uses the gateway-returned content (already
                        // authenticated via the BFF; no public URL, no API key).
                        href={createDownloadUrl(a.content ?? "", filename)}
                        download={filename}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        aria-label={`Download ${filename}`}
                      >
                        <Download className="size-3" aria-hidden="true" />
                        Download
                      </a>
                    ) : (
                      <span
                        className="inline-flex h-7 items-center text-[11px] text-muted-foreground"
                        title="Artifact content exceeds 64KB inline limit; gateway has no streaming endpoint."
                      >
                        Download unavailable
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Create a Blob URL for downloading an artifact. Uses the inlined content
 * from the gateway response (already authenticated via the BFF).
 *
 * Per req #4: NO public artifact URLs, NO Gateway API key exposure. The
 * Blob URL is in-memory and bound to the browser session.
 */
function createDownloadUrl(content: string, _filename: string): string {
  // Blob with the raw content — the browser handles MIME detection from
  // the download attribute's extension.
  const blob = new Blob([content], { type: "application/octet-stream" });
  return URL.createObjectURL(blob);
}
