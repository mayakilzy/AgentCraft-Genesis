/**
 * AgentCraft Genesis G7-04 — Artifact utility library.
 *
 * Per G7-04 acceptance requirements:
 *   1. Verification status originates from explicit authoritative engine
 *      evidence (the gateway's artifact.verified field). Never infer VERIFIED
 *      from mission success, artifact presence, filename, or UI heuristics.
 *   2. Distinguish VERIFIED, UNVERIFIED, UNKNOWN, NOT_AVAILABLE. Do not
 *      invent verification checks or timestamps.
 *   3. Preview only supported safe formats. Treat artifact names, MIME types,
 *      and content as untrusted. Prevent HTML/SVG execution, script injection,
 *      path traversal, and unsafe download filenames.
 *
 * Source-of-truth for the verification field:
 *   src/gateway/mission-service.ts:791 — `verified: verificationOk && verifiedPaths.has(path)`
 *   The gateway computes this from the actual VerificationResult captured
 *   when the mission finished. If verification hasn't run (mission RUNNING
 *   or CANCELLED before verification), `verified` is `false`.
 *
 * No separate /verification endpoint exists (verified by source inspection
 * in G7-01 capability matrix). The UI must NOT invent verification checks,
 * timestamps, or "verification source" strings.
 */

// ---------------------------------------------------------------------------
// Verification state mapping (req #1, #2)
// ---------------------------------------------------------------------------

export type VerificationState =
  /** Verification passed AND this artifact path is in the verified set. */
  | "VERIFIED"
  /** Verification ran but did not pass; OR verification hasn't run yet
   * (mission non-terminal, CANCELLED before verification). */
  | "UNVERIFIED"
  /** The gateway returned an artifact record without the `verified` field
   * (defensive — should never happen since the gateway always sets it). */
  | "UNKNOWN"
  /** No artifacts exist for this mission (empty array from the gateway). */
  | "NOT_AVAILABLE";

export interface ArtifactMeta {
  /** Human-readable label (NON-color-only cue). */
  readonly label: string;
  /** Lucide icon name (resolved in component). */
  readonly icon: string;
  /** Tailwind tone. */
  readonly tone: "success" | "warning" | "danger" | "neutral" | "info";
  /** One-line honest description of what this state means. */
  readonly description: string;
}

export const VERIFICATION_META: Record<VerificationState, ArtifactMeta> = {
  VERIFIED: {
    label: "Verified",
    icon: "CheckCircle2",
    tone: "success",
    description:
      "The gateway's verification loop ran on the clean-room copy and this artifact path is in the verified set.",
  },
  UNVERIFIED: {
    label: "Unverified",
    icon: "XCircle",
    tone: "warning",
    description:
      "Verification either did not pass for this artifact, or the mission did not reach verification (e.g., still RUNNING, or CANCELLED before verification).",
  },
  UNKNOWN: {
    label: "Unknown",
    icon: "HelpCircle",
    tone: "neutral",
    description:
      "The gateway returned an artifact record without the `verified` field. This should not happen; treat as unverified.",
  },
  NOT_AVAILABLE: {
    label: "Not available",
    icon: "Inbox",
    tone: "neutral",
    description:
      "No artifacts exist for this mission. The gateway returned an empty array.",
  },
};

/**
 * Map the gateway's `verified` field to a UI VerificationState.
 *
 * Per req #1: NEVER infer VERIFIED from mission success, artifact presence,
 * filename, or UI heuristics. The ONLY source of truth is the gateway's
 * `verified` boolean.
 *
 * Per req #2: Distinguish VERIFIED, UNVERIFIED, UNKNOWN, NOT_AVAILABLE.
 */
export function verificationStateFromArtifact(
  verified: boolean | undefined,
): VerificationState {
  if (verified === true) return "VERIFIED";
  if (verified === false) return "UNVERIFIED";
  return "UNKNOWN";
}

/**
 * Map a mission's artifact list to a mission-level verification state.
 * - Empty list → NOT_AVAILABLE
 * - All verified=true → VERIFIED
 * - Any verified=false → UNVERIFIED (most conservative — one unverified
 *   artifact means the mission's verification is incomplete)
 * - Otherwise (all undefined) → UNKNOWN
 */
export function missionVerificationState(
  artifacts: ReadonlyArray<{ verified?: boolean }>,
): VerificationState {
  if (artifacts.length === 0) return "NOT_AVAILABLE";
  const allVerified = artifacts.every((a) => a.verified === true);
  if (allVerified) return "VERIFIED";
  const anyUnverified = artifacts.some((a) => a.verified === false);
  if (anyUnverified) return "UNVERIFIED";
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Safe filename sanitization (req #3, #4)
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename for client-side download (Blob + URL.createObjectURL).
 *
 * The gateway already rejects paths with `..` or leading `/` (mission-service.ts:806),
 * and the BFF's isSafeSegment() validates path segments again. This function
 * is the LAST defense-in-depth layer — it extracts the basename (last path
 * segment) and strips control characters.
 *
 * The result is used ONLY as the download attribute on an <a> element. It is
 * never used to construct a file path on the client (Blob is in-memory).
 */
export function sanitizeDownloadFilename(path: string): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    return "artifact";
  }
  // Take the basename (last segment after any path separator).
  const segments = path.split(/[/\\]/);
  let basename = segments[segments.length - 1] || "artifact";
  // Reject null bytes, control chars (0x00-0x1F, 0x7F).
  basename = basename.replace(/[\x00-\x1f\x7f]/g, "");
  // Reject leading dots (hidden files / directory traversal remnants).
  basename = basename.replace(/^\.+/, "");
  // Trim leading/trailing whitespace.
  basename = basename.trim();
  // Limit length to prevent path-buffer issues.
  if (basename.length > 200) {
    const ext = basename.includes(".")
      ? basename.slice(basename.lastIndexOf("."))
      : "";
    basename = basename.slice(0, 200 - ext.length) + ext;
  }
  return basename || "artifact";
}

// ---------------------------------------------------------------------------
// Safe preview MIME type detection (req #3)
// ---------------------------------------------------------------------------

export type PreviewKind =
  | "text"
  | "markdown"
  | "image-png"
  | "image-jpeg"
  | "image-gif"
  | "image-webp"
  | "pdf"
  /** HTML/SVG/etc. — render as escaped text source code, NO execution. */
  | "text-source"
  /** Unsupported — show a "preview not available" notice. */
  | "unsupported";

const MIME_TO_PREVIEW: Record<string, PreviewKind> = {
  "text/plain": "text",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "image/png": "image-png",
  "image/jpeg": "image-jpeg",
  "image/gif": "image-gif",
  "image/webp": "image-webp",
  "application/pdf": "pdf",
};

const EXT_TO_PREVIEW: Record<string, PreviewKind> = {
  ".txt": "text",
  ".md": "markdown",
  ".markdown": "markdown",
  ".png": "image-png",
  ".jpg": "image-jpeg",
  ".jpeg": "image-jpeg",
  ".gif": "image-gif",
  ".webp": "image-webp",
  ".pdf": "pdf",
};

// File extensions that are UNSAFE to render as anything but escaped text.
// These include HTML, SVG, and any script-capable format.
const UNSAFE_EXTS = new Set([
  ".html",
  ".htm",
  ".xhtml",
  ".svg",
  ".xml",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".json",
]);

const UNSAFE_MIMES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/xml",
  "text/xml",
]);

/**
 * Detect the preview kind from an artifact's path + content.
 *
 * The path is the gateway-returned artifact path. The MIME type is NOT
 * returned by the gateway — we infer it from the file extension (with
 * UNSAFE_EXTS handled as text-source).
 *
 * Per req #3: HTML/SVG/XML/etc. are rendered as escaped text source code
 * in a <pre> block. They are NEVER executed (no innerHTML, no dangerouslySetInnerHTML).
 */
export function detectPreviewKind(path: string): PreviewKind {
  if (typeof path !== "string" || path.length === 0) {
    return "unsupported";
  }
  const lower = path.toLowerCase();
  // Check unsafe extensions first — they must render as text-source.
  for (const ext of UNSAFE_EXTS) {
    if (lower.endsWith(ext)) {
      return "text-source";
    }
  }
  // Check safe extensions.
  for (const [ext, kind] of Object.entries(EXT_TO_PREVIEW)) {
    if (lower.endsWith(ext)) {
      return kind;
    }
  }
  return "unsupported";
}

/**
 * Get the MIME type for a preview kind (for Blob construction).
 */
export function previewKindToMime(kind: PreviewKind): string {
  switch (kind) {
    case "text":
      return "text/plain;charset=utf-8";
    case "markdown":
      return "text/markdown;charset=utf-8";
    case "image-png":
      return "image/png";
    case "image-jpeg":
      return "image/jpeg";
    case "image-gif":
      return "image/gif";
    case "image-webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "text-source":
      return "text/plain;charset=utf-8";
    case "unsupported":
    default:
      return "application/octet-stream";
  }
}

/**
 * Escape HTML special characters for safe rendering in a <pre> block.
 *
 * This is the ONLY way HTML/SVG content is rendered — as escaped text.
 * No innerHTML, no dangerouslySetInnerHTML, no DOMPurify (would be a new
 * dependency). Just standard entity escaping.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Convert raw content bytes (string) to a base64 data URL for image/PDF preview.
 *
 * The content from the gateway is a UTF-8 string. For images, we need to
 * convert it to base64. For text, we use Blob + URL.createObjectURL.
 */
export function contentToDataUrl(content: string, mime: string): string {
  // Convert string → bytes → base64.
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return `data:${mime};base64,${base64}`;
}
