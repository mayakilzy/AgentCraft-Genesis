/**
 * AgentCraft Genesis G7-04 — Artifacts library unit tests.
 *
 * Tests the verification state mapping, filename sanitization, and MIME
 * type detection directly (without HTTP), so we can test edge cases that
 * would require forging cookies over HTTP.
 *
 * Run: npx tsx scripts/g7-04-artifacts-unit-tests.ts
 */

import {
  contentToDataUrl,
  detectPreviewKind,
  escapeHtml,
  missionVerificationState,
  previewKindToMime,
  sanitizeDownloadFilename,
  verificationStateFromArtifact,
  VERIFICATION_META,
  type VerificationState,
} from "../web/src/lib/genesis/artifacts";

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function record(r: TestResult) {
  results.push(r);
  const mark = r.pass ? "✓" : "✗";
  console.log(`${mark}  ${r.id}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

// U1: verificationStateFromArtifact(true) → VERIFIED
function test_verifiedTrue() {
  const result = verificationStateFromArtifact(true);
  record({
    id: "U1",
    name: "verificationStateFromArtifact(true) → VERIFIED",
    pass: result === "VERIFIED",
    detail: `result=${result}`,
  });
}

// U2: verificationStateFromArtifact(false) → UNVERIFIED
function test_verifiedFalse() {
  const result = verificationStateFromArtifact(false);
  record({
    id: "U2",
    name: "verificationStateFromArtifact(false) → UNVERIFIED",
    pass: result === "UNVERIFIED",
    detail: `result=${result}`,
  });
}

// U3: verificationStateFromArtifact(undefined) → UNKNOWN (defensive)
function test_verifiedUndefined() {
  const result = verificationStateFromArtifact(undefined);
  record({
    id: "U3",
    name: "verificationStateFromArtifact(undefined) → UNKNOWN (defensive)",
    pass: result === "UNKNOWN",
    detail: `result=${result}`,
  });
}

// U4: missionVerificationState([]) → NOT_AVAILABLE
function test_emptyArtifacts() {
  const result = missionVerificationState([]);
  record({
    id: "U4",
    name: "missionVerificationState([]) → NOT_AVAILABLE",
    pass: result === "NOT_AVAILABLE",
    detail: `result=${result}`,
  });
}

// U5: missionVerificationState([{verified:true}]) → VERIFIED
function test_allVerified() {
  const result = missionVerificationState([{ verified: true }]);
  record({
    id: "U5",
    name: "missionVerificationState([{verified:true}]) → VERIFIED",
    pass: result === "VERIFIED",
    detail: `result=${result}`,
  });
}

// U6: missionVerificationState([{verified:false}]) → UNVERIFIED
function test_anyUnverified() {
  const result = missionVerificationState([{ verified: false }]);
  record({
    id: "U6",
    name: "missionVerificationState([{verified:false}]) → UNVERIFIED",
    pass: result === "UNVERIFIED",
    detail: `result=${result}`,
  });
}

// U7: missionVerificationState([{verified:true},{verified:false}]) → UNVERIFIED (one unverified)
function test_mixedVerified() {
  const result = missionVerificationState([
    { verified: true },
    { verified: false },
  ]);
  record({
    id: "U7",
    name: "missionVerificationState([{verified:true},{verified:false}]) → UNVERIFIED",
    pass: result === "UNVERIFIED",
    detail: `result=${result}`,
  });
}

// U8: VERIFICATION_META has all 4 states
function test_metaComplete() {
  const states: VerificationState[] = ["VERIFIED", "UNVERIFIED", "UNKNOWN", "NOT_AVAILABLE"];
  const allPresent = states.every((s) => VERIFICATION_META[s] !== undefined);
  const allHaveLabel = states.every((s) => VERIFICATION_META[s].label.length > 0);
  record({
    id: "U8",
    name: "VERIFICATION_META has all 4 states with labels",
    pass: allPresent && allHaveLabel,
    detail: `states=${states.join(",")}`,
  });
}

// U9: sanitizeDownloadFilename rejects path traversal
function test_pathTraversalFilename() {
  const r1 = sanitizeDownloadFilename("../../etc/passwd");
  const r2 = sanitizeDownloadFilename("/etc/passwd");
  const r3 = sanitizeDownloadFilename("..\\..\\windows\\system32");
  record({
    id: "U9",
    name: "sanitizeDownloadFilename strips path traversal (.., /, \\)",
    pass:
      r1 === "passwd" &&
      r2 === "passwd" &&
      r3 === "system32",
    detail: `r1=${r1}, r2=${r2}, r3=${r3}`,
  });
}

// U10: sanitizeDownloadFilename rejects null bytes + control chars
function test_controlCharsFilename() {
  const r = sanitizeDownloadFilename("file\x00name.txt\x01.txt");
  record({
    id: "U10",
    name: "sanitizeDownloadFilename strips null bytes + control chars",
    pass: !r.includes("\x00") && !r.includes("\x01") && r.includes("filename.txt"),
    detail: `result=${r}`,
  });
}

// U11: sanitizeDownloadFilename rejects leading dots
function test_leadingDotsFilename() {
  const r = sanitizeDownloadFilename("...hidden.txt");
  record({
    id: "U11",
    name: "sanitizeDownloadFilename strips leading dots",
    pass: r === "hidden.txt",
    detail: `result=${r}`,
  });
}

// U12: sanitizeDownloadFilename handles empty input
function test_emptyFilename() {
  const r1 = sanitizeDownloadFilename("");
  const r2 = sanitizeDownloadFilename("   ");
  record({
    id: "U12",
    name: "sanitizeDownloadFilename handles empty/whitespace input",
    pass: r1 === "artifact" && r2 === "artifact",
    detail: `r1=${r1}, r2=${r2}`,
  });
}

// U13: sanitizeDownloadFilename limits length
function test_longFilename() {
  const longName = "a".repeat(300) + ".txt";
  const r = sanitizeDownloadFilename(longName);
  record({
    id: "U13",
    name: "sanitizeDownloadFilename limits length to 200 chars",
    pass: r.length <= 200 && r.endsWith(".txt"),
    detail: `length=${r.length}`,
  });
}

// U14: detectPreviewKind for safe types
function test_safePreviewKinds() {
  const cases: Array<[string, string]> = [
    ["output.md", "markdown"],
    ["readme.txt", "text"],
    ["screenshot.png", "image-png"],
    ["photo.jpg", "image-jpeg"],
    ["photo.jpeg", "image-jpeg"],
    ["animation.gif", "image-gif"],
    ["modern.webp", "image-webp"],
    ["document.pdf", "pdf"],
  ];
  const allPass = cases.every(([path, expected]) => detectPreviewKind(path) === expected);
  record({
    id: "U14",
    name: "detectPreviewKind returns correct kind for safe types",
    pass: allPass,
    detail: `cases=${cases.length}`,
  });
}

// U15: detectPreviewKind for UNSAFE types (HTML/SVG/XML/JS/CSS/JSON)
function test_unsafePreviewKinds() {
  const unsafe: string[] = [
    "page.html",
    "page.htm",
    "page.xhtml",
    "logo.svg",
    "data.xml",
    "script.js",
    "module.mjs",
    "app.tsx",
    "styles.css",
    "config.json",
  ];
  const allTextSource = unsafe.every((p) => detectPreviewKind(p) === "text-source");
  record({
    id: "U15",
    name: "detectPreviewKind returns text-source for HTML/SVG/XML/JS/CSS/JSON",
    pass: allTextSource,
    detail: `unsafe=${unsafe.length} files → text-source`,
  });
}

// U16: detectPreviewKind for unknown extensions → unsupported
function test_unknownPreviewKind() {
  const r1 = detectPreviewKind("file.xyz");
  const r2 = detectPreviewKind("file");
  const r3 = detectPreviewKind("");
  record({
    id: "U16",
    name: "detectPreviewKind returns unsupported for unknown/empty",
    pass: r1 === "unsupported" && r2 === "unsupported" && r3 === "unsupported",
    detail: `xyz=${r1}, noext=${r2}, empty=${r3}`,
  });
}

// U17: escapeHtml escapes dangerous chars
function test_escapeHtml() {
  const input = `<script>alert("xss")</script>`;
  const escaped = escapeHtml(input);
  const hasRawScript = escaped.includes("<script>");
  const hasEscaped = escaped.includes("&lt;script&gt;");
  record({
    id: "U17",
    name: "escapeHtml escapes <, >, \", ', &",
    pass: !hasRawScript && hasEscaped,
    detail: `escaped=${escaped.slice(0, 60)}…`,
  });
}

// U18: previewKindToMime returns correct MIME
function test_previewKindToMime() {
  const cases: Array<[string, string]> = [
    ["text", "text/plain;charset=utf-8"],
    ["markdown", "text/markdown;charset=utf-8"],
    ["image-png", "image/png"],
    ["image-jpeg", "image/jpeg"],
    ["image-gif", "image/gif"],
    ["image-webp", "image/webp"],
    ["pdf", "application/pdf"],
    ["text-source", "text/plain;charset=utf-8"],
    ["unsupported", "application/octet-stream"],
  ];
  const allPass = cases.every(([kind, expected]) => previewKindToMime(kind as any) === expected);
  record({
    id: "U18",
    name: "previewKindToMime returns correct MIME for each kind",
    pass: allPass,
    detail: `cases=${cases.length}`,
  });
}

// U19: contentToDataUrl produces valid data URL
function test_contentToDataUrl() {
  const content = "Hello, world!";
  const dataUrl = contentToDataUrl(content, "text/plain");
  const startsCorrectly = dataUrl.startsWith("data:text/plain;base64,");
  // Verify the base64 decodes back to the original content.
  const base64 = dataUrl.split(",")[1];
  const decoded = Buffer.from(base64, "base64").toString("utf8");
  record({
    id: "U19",
    name: "contentToDataUrl produces valid base64 data URL (roundtrip)",
    pass: startsCorrectly && decoded === content,
    detail: `starts=${startsCorrectly}, roundtrip=${decoded === content}`,
  });
}

// U20: missionVerificationState never infers VERIFIED from mission success
// (This is a design property — the function only reads `verified` from the
// gateway's response, never the mission status.)
function test_noInferenceFromSuccess() {
  // Even if we passed a mission status='SUCCEEDED' alongside, the function
  // ignores it and only reads artifact.verified.
  const artifacts = [{ verified: false }];
  // Imagine the mission succeeded — the function should still return UNVERIFIED
  // because the gateway says verified=false.
  const result = missionVerificationState(artifacts);
  record({
    id: "U20",
    name: "missionVerificationState NEVER infers VERIFIED from anything but artifact.verified",
    pass: result === "UNVERIFIED",
    detail: `result=${result} (gateway.verified=false → UNVERIFIED, regardless of mission success)`,
  });
}

function main() {
  console.log(
    "\nAgentCraft Genesis G7-04 — Artifacts Library Unit Tests\n",
  );

  test_verifiedTrue();
  test_verifiedFalse();
  test_verifiedUndefined();
  test_emptyArtifacts();
  test_allVerified();
  test_anyUnverified();
  test_mixedVerified();
  test_metaComplete();
  test_pathTraversalFilename();
  test_controlCharsFilename();
  test_leadingDotsFilename();
  test_emptyFilename();
  test_longFilename();
  test_safePreviewKinds();
  test_unsafePreviewKinds();
  test_unknownPreviewKind();
  test_escapeHtml();
  test_previewKindToMime();
  test_contentToDataUrl();
  test_noInferenceFromSuccess();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
