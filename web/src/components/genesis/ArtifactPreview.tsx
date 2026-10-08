"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MissionArtifactRecord } from "@/lib/genesis/types";
import {
  contentToDataUrl,
  detectPreviewKind,
  escapeHtml,
  previewKindToMime,
  VERIFICATION_META,
  verificationStateFromArtifact,
} from "@/lib/genesis/artifacts";
import { cn } from "@/lib/utils";

interface ArtifactPreviewProps {
  artifact: MissionArtifactRecord | null;
  onClose?: () => void;
}

/**
 * ArtifactPreview — safe preview of an artifact's content.
 *
 * Per req #3: Preview only supported safe formats. Treat artifact names,
 * MIME types, and content as UNTRUSTED. Prevent HTML/SVG execution, script
 * injection, path traversal, and unsafe download filenames.
 *
 * Safe formats:
 *   - text/plain, text/markdown → <pre> with escaped content
 *   - image/png, jpeg, gif, webp → <img> with data URL (base64)
 *   - application/pdf → <object> with data URL (sandboxed)
 *
 * Unsafe formats (HTML, SVG, XML, JS, CSS, JSON):
 *   - Render as ESCAPED text source code in a <pre> block.
 *   - NEVER use innerHTML or dangerouslySetInnerHTML.
 *   - NEVER execute scripts.
 *
 * Per req #3: Path traversal is blocked by the gateway (rejects '..' and
 * leading '/'). The BFF's isSafeSegment() validates again. The preview
 * does NOT use the path as a filesystem reference — only as a label.
 */
export function ArtifactPreview({ artifact, onClose }: ArtifactPreviewProps) {
  if (!artifact) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        Select an artifact from the list to preview its content.
      </div>
    );
  }

  const previewKind = detectPreviewKind(artifact.path);
  const content = artifact.content;
  const verState = verificationStateFromArtifact(artifact.verified);
  const verMeta = VERIFICATION_META[verState];

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-medium font-mono truncate" title={artifact.path}>
            {artifact.path}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            worker: <span className="font-mono">{artifact.workerId}</span> ·{" "}
            size: {artifact.bytes} bytes ·{" "}
            verification: {verMeta.label}
          </p>
        </div>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-7 text-xs"
          >
            Close
          </Button>
        )}
      </div>

      {!content && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning flex items-start gap-2"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-medium">Content not inline.</p>
            <p>
              The gateway inlines artifact content only when ≤64KB. This artifact
              exceeds that limit or the gateway omitted content. The gateway has
              no streaming endpoint in v1 — preview and download are unavailable
              for this artifact.
            </p>
          </div>
        </div>
      )}

      {content && previewKind === "unsupported" && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2"
        >
          <FileText className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-medium">Preview not supported for this file type.</p>
            <p>
              The artifact path extension is not in the safe-preview allowlist.
              Use the Download button in the artifact list to save the raw bytes
              and open with an external tool.
            </p>
          </div>
        </div>
      )}

      {content && (previewKind === "text-source") && (
        <div className="space-y-2">
          <div
            className="rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-warning flex items-start gap-1.5"
            role="note"
          >
            <ShieldOff className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong>Source code rendering only.</strong> This file type
              (HTML/SVG/XML/JS/CSS/JSON) is rendered as ESCAPED text in a{" "}
              <code className="font-mono">&lt;pre&gt;</code> block. It is
              NEVER executed. No <code className="font-mono">innerHTML</code>,
              no <code className="font-mono">dangerouslySetInnerHTML</code>.
            </div>
          </div>
          <pre
            className="max-h-[400px] overflow-auto scrollbar-clean rounded-md border border-border bg-card p-3 text-[11px] font-mono whitespace-pre-wrap break-words"
            aria-label={`Source code of ${artifact.path}`}
          >
            {escapeHtml(content)}
          </pre>
        </div>
      )}

      {content && (previewKind === "text" || previewKind === "markdown") && (
        <pre
          className="max-h-[400px] overflow-auto scrollbar-clean rounded-md border border-border bg-card p-3 text-xs font-mono whitespace-pre-wrap break-words"
          aria-label={`Text content of ${artifact.path}`}
        >
          {content}
        </pre>
      )}

      {content && previewKind.startsWith("image-") && (
        <ImageDataPreview content={content} kind={previewKind} path={artifact.path} />
      )}

      {content && previewKind === "pdf" && (
        <PdfDataPreview content={content} path={artifact.path} />
      )}
    </div>
  );
}

/**
 * Image preview via base64 data URL. The content is the raw bytes (as a
 * UTF-8 string from the gateway). We convert to base64 and embed in a data URL.
 *
 * Per req #3: <img> elements cannot execute scripts. The data URL is
 * sandboxed by the browser. The src is set via React's JSX (not via
 * innerHTML), preventing attribute injection.
 */
function ImageDataPreview({
  content,
  kind,
  path,
}: {
  content: string;
  kind: "image-png" | "image-jpeg" | "image-gif" | "image-webp";
  path: string;
}) {
  const dataUrl = useMemo(() => {
    try {
      return contentToDataUrl(content, previewKindToMime(kind));
    } catch {
      return null;
    }
  }, [content, kind]);

  if (!dataUrl) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
        Could not decode image content for preview.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <img
        src={dataUrl}
        alt={`Preview of ${path}`}
        className="max-w-full max-h-[400px] rounded-md border border-border"
        loading="lazy"
        // Sandbox: no referrers, no cross-origin fetches for the data URL.
        referrerPolicy="no-referrer"
      />
      <p className="text-[10px] text-muted-foreground">
        Rendered as <code className="font-mono">{previewKindToMime(kind)}</code> via base64 data URL.
      </p>
    </div>
  );
}

/**
 * PDF preview via <object> with a base64 data URL.
 *
 * PDFs are safe in browsers — they cannot execute arbitrary scripts on the
 * host page. The <object> element renders the PDF in a sandboxed viewer.
 */
function PdfDataPreview({ content, path }: { content: string; path: string }) {
  const dataUrl = useMemo(() => {
    try {
      return contentToDataUrl(content, "application/pdf");
    } catch {
      return null;
    }
  }, [content]);

  if (!dataUrl) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
        Could not decode PDF content for preview.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <object
        data={dataUrl}
        type="application/pdf"
        className="w-full h-[400px] rounded-md border border-border"
        aria-label={`PDF preview of ${path}`}
      >
        <p className="p-4 text-xs text-muted-foreground">
          Your browser does not support inline PDF preview. Use the Download
          button to save the file and open it externally.
        </p>
      </object>
      <p className="text-[10px] text-muted-foreground">
        Rendered as <code className="font-mono">application/pdf</code> via base64 data URL in a sandboxed <code className="font-mono">&lt;object&gt;</code>.
      </p>
    </div>
  );
}
