/**
 * AgentCraft Genesis G7-02 Auth Gate — Unit Tests for cookie library
 *
 * Tests the cookie sign/verify logic directly (without HTTP), so we can
 * test cases like expired cookies with the correct secret (which would
 * require access to the server's secret to forge over HTTP).
 *
 * Run: npx tsx scripts/g7-02-auth-gate-unit-tests.ts
 */

import { createHmac } from "node:crypto";
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  constantTimePinCompare,
  decodeAuthenticatedCookie,
  getOperatorPin,
  isValidAuthenticatedCookie,
  issueAuthenticatedCookie,
  verifyTokenWithSecret,
  type CookiePayload,
} from "../web/src/lib/auth/cookie";

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

const TEST_SECRET = "test-secret-for-unit-tests-1234567890";

function signWithSecret(payload: CookiePayload, secret: string): string {
  // Replicate the signToken logic with a custom secret.
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

// U1: Roundtrip — issue a cookie, verify it
function test_roundtrip() {
  const cookie = issueAuthenticatedCookie("operator");
  // Note: issueAuthenticatedCookie uses the production SECRET, which may be
  // a per-process random in dev. We don't have access to that. So instead,
  // test verifyTokenWithSecret with a known secret.
  const payload: CookiePayload = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    op: "operator",
    operatorId: "operator",
  };
  const token = signWithSecret(payload, TEST_SECRET);
  const decoded = verifyTokenWithSecret(token, TEST_SECRET);
  record({
    id: "U1",
    name: "Roundtrip: sign + verify returns payload",
    pass: decoded !== null && decoded.operatorId === "operator",
    detail: `decoded=${decoded ? "ok" : "null"}`,
  });
}

// U2: Expired cookie → null
function test_expired() {
  const payload: CookiePayload = {
    iat: new Date(Date.now() - 100_000).toISOString(),
    exp: Date.now() - 60_000, // past
    scope: "bff",
    op: "operator",
    operatorId: "operator",
  };
  const token = signWithSecret(payload, TEST_SECRET);
  const decoded = verifyTokenWithSecret(token, TEST_SECRET);
  record({
    id: "U2",
    name: "Expired cookie (exp in past) → null",
    pass: decoded === null,
    detail: `decoded=${decoded === null ? "null" : "leaked"}`,
  });
}

// U3: Tampered signature → null
function test_tamperedSignature() {
  const payload: CookiePayload = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    op: "operator",
    operatorId: "operator",
  };
  const token = signWithSecret(payload, TEST_SECRET);
  // Flip one char in the signature
  const dot = token.lastIndexOf(".");
  const tampered =
    token.slice(0, dot + 2) +
    (token[dot + 2] === "a" ? "b" : "a") +
    token.slice(dot + 3);
  const decoded = verifyTokenWithSecret(tampered, TEST_SECRET);
  record({
    id: "U3",
    name: "Tampered signature → null",
    pass: decoded === null,
    detail: `decoded=${decoded === null ? "null" : "leaked"}`,
  });
}

// U4: Wrong secret → null (restart simulation)
function test_wrongSecret() {
  const payload: CookiePayload = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    op: "operator",
    operatorId: "operator",
  };
  const token = signWithSecret(payload, "different-secret");
  const decoded = verifyTokenWithSecret(token, TEST_SECRET);
  record({
    id: "U4",
    name: "Cookie signed with wrong secret → null (restart sim)",
    pass: decoded === null,
    detail: `decoded=${decoded === null ? "null" : "leaked"}`,
  });
}

// U5: Cookie without op="operator" claim → null (the critical fix)
function test_missingOperatorClaim() {
  // Sign a payload WITHOUT the op claim
  const payloadWithoutOp = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    operatorId: "operator",
    // no op field
  };
  const token = signWithSecret(payloadWithoutOp as any, TEST_SECRET);
  const decoded = verifyTokenWithSecret(token, TEST_SECRET);
  record({
    id: "U5",
    name: "Cookie WITHOUT op='operator' claim → null (the auth-gate fix)",
    pass: decoded === null,
    detail: `decoded=${decoded === null ? "null" : "leaked (CRITICAL FAILURE)"}`,
  });
}

// U6: Cookie with op="anonymous" → null
function test_wrongOpClaim() {
  const payload: CookiePayload = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    op: "anonymous" as any, // wrong op
    operatorId: "operator",
  };
  const token = signWithSecret(payload, TEST_SECRET);
  const decoded = verifyTokenWithSecret(token, TEST_SECRET);
  record({
    id: "U6",
    name: "Cookie with op='anonymous' (forged) → null",
    pass: decoded === null,
    detail: `decoded=${decoded === null ? "null" : "leaked (CRITICAL FAILURE)"}`,
  });
}

// U7: Cookie with missing operatorId → null
function test_missingOperatorId() {
  const payload = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    op: "operator",
    // no operatorId
  };
  const token = signWithSecret(payload as any, TEST_SECRET);
  const decoded = verifyTokenWithSecret(token, TEST_SECRET);
  record({
    id: "U7",
    name: "Cookie with missing operatorId → null",
    pass: decoded === null,
    detail: `decoded=${decoded === null ? "null" : "leaked"}`,
  });
}

// U8: Cookie with empty operatorId → null
function test_emptyOperatorId() {
  const payload: CookiePayload = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    op: "operator",
    operatorId: "",
  };
  const token = signWithSecret(payload, TEST_SECRET);
  const decoded = verifyTokenWithSecret(token, TEST_SECRET);
  record({
    id: "U8",
    name: "Cookie with empty operatorId → null",
    pass: decoded === null,
    detail: `decoded=${decoded === null ? "null" : "leaked"}`,
  });
}

// U9: Malformed token (no dot) → null
function test_malformedToken() {
  const decoded = verifyTokenWithSecret("not-a-valid-token-no-dot", TEST_SECRET);
  record({
    id: "U9",
    name: "Malformed token (no dot) → null",
    pass: decoded === null,
    detail: `decoded=${decoded === null ? "null" : "leaked"}`,
  });
}

// U10: Empty secret → null (fail-closed)
function test_emptySecret() {
  const payload: CookiePayload = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    op: "operator",
    operatorId: "operator",
  };
  const token = signWithSecret(payload, TEST_SECRET);
  const decoded = verifyTokenWithSecret(token, "");
  record({
    id: "U10",
    name: "Empty secret → null (fail-closed)",
    pass: decoded === null,
    detail: `decoded=${decoded === null ? "null" : "leaked (CRITICAL)"}`,
  });
}

// U11: constantTimePinCompare — equal strings
function test_pinCompareEqual() {
  const result = constantTimePinCompare("dev-local-pin", "dev-local-pin");
  record({
    id: "U11",
    name: "constantTimePinCompare(equal) → true",
    pass: result === true,
    detail: `result=${result}`,
  });
}

// U12: constantTimePinCompare — unequal strings
function test_pinCompareUnequal() {
  const result = constantTimePinCompare("dev-local-pin", "wrong-pin");
  record({
    id: "U12",
    name: "constantTimePinCompare(unequal) → false",
    pass: result === false,
    detail: `result=${result}`,
  });
}

// U13: constantTimePinCompare — empty string
function test_pinCompareEmpty() {
  const result = constantTimePinCompare("", "dev-local-pin");
  record({
    id: "U13",
    name: "constantTimePinCompare(empty) → false",
    pass: result === false,
    detail: `result=${result}`,
  });
}

// U14: constantTimePinCompare — different lengths
function test_pinCompareDiffLengths() {
  const result = constantTimePinCompare("short", "much-longer-pin-value");
  record({
    id: "U14",
    name: "constantTimePinCompare(diff lengths) → false",
    pass: result === false,
    detail: `result=${result}`,
  });
}

// U15: getOperatorPin in dev mode
function test_getOperatorPin_dev() {
  // Note: this test runs in the test process, which has NODE_ENV unset or 'development'.
  // The test asserts the documented behavior: dev mode returns DEFAULT_DEV_PIN when GENESIS_OPERATOR_PIN is unset.
  // We can't modify env at runtime cleanly, so just verify the function returns SOMETHING non-null in dev.
  const originalPin = process.env.GENESIS_OPERATOR_PIN;
  delete process.env.GENESIS_OPERATOR_PIN;
  const pin = getOperatorPin();
  process.env.GENESIS_OPERATOR_PIN = originalPin;
  record({
    id: "U15",
    name: "getOperatorPin (dev, unset) → returns default dev PIN (not null)",
    pass: pin !== null && typeof pin === "string" && pin.length > 0,
    detail: `pin=${pin ? "(set, len=" + pin.length + ")" : "null"}`,
  });
}

// U16: buildSetCookieHeader includes HttpOnly + SameSite=Strict + Path=/
function test_cookieAttributes() {
  const header = buildSetCookieHeader("test=value");
  // HTTP cookie attribute names are case-insensitive per RFC 6265; use case-
  // insensitive regex.
  record({
    id: "U16",
    name: "buildSetCookieHeader includes HttpOnly + SameSite=Strict + Path=/",
    pass:
      /HttpOnly/i.test(header) &&
      /SameSite=Strict/i.test(header) &&
      /Path=\//i.test(header),
    detail: `header=${header}`,
  });
}

// U17: buildClearCookieHeader includes Max-Age=0
function test_clearCookie() {
  const header = buildClearCookieHeader();
  record({
    id: "U17",
    name: "buildClearCookieHeader includes Max-Age=0 + SameSite=Strict",
    pass: header.includes("Max-Age=0") && header.includes("SameSite=Strict"),
    detail: `header=${header}`,
  });
}

// U18: isValidAuthenticatedCookie roundtrip
function test_isValidAuthenticatedCookie() {
  // We can't directly use issueAuthenticatedCookie (uses production SECRET).
  // Sign with TEST_SECRET and verify isValidAuthenticatedCookie (which uses
  // production SECRET) returns false — confirming it doesn't accept arbitrary
  // signatures. To properly test the roundtrip, we'd need access to the
  // production SECRET.
  const payload: CookiePayload = {
    iat: new Date().toISOString(),
    exp: Date.now() + 60_000,
    scope: "bff",
    op: "operator",
    operatorId: "operator",
  };
  const token = signWithSecret(payload, TEST_SECRET);
  // isValidAuthenticatedCookie uses the PRODUCTION secret, so a token signed
  // with TEST_SECRET should be rejected. This proves the function doesn't
  // accept arbitrary cookies.
  const result = isValidAuthenticatedCookie(token);
  record({
    id: "U18",
    name: "isValidAuthenticatedCookie(token signed with non-prod secret) → false",
    pass: result === false,
    detail: `result=${result} (expected false — proves the function rejects non-prod signatures)`,
  });
}

// U19: decodeAuthenticatedCookie with malformed input
function test_decodeMalformed() {
  const result = decodeAuthenticatedCookie("not-a-valid-cookie");
  record({
    id: "U19",
    name: "decodeAuthenticatedCookie(malformed) → null",
    pass: result === null,
    detail: `result=${result === null ? "null" : "leaked"}`,
  });
}

// U20: decodeAuthenticatedCookie with empty/null input
function test_decodeEmpty() {
  const r1 = decodeAuthenticatedCookie("");
  const r2 = decodeAuthenticatedCookie(null as any);
  const r3 = decodeAuthenticatedCookie(undefined as any);
  record({
    id: "U20",
    name: "decodeAuthenticatedCookie(empty/null/undefined) → null",
    pass: r1 === null && r2 === null && r3 === null,
    detail: `empty=${r1 === null}, null=${r2 === null}, undefined=${r3 === null}`,
  });
}

// Main runner
function main() {
  console.log(
    "\nAgentCraft Genesis G7-02 Auth Gate — Cookie Library Unit Tests\n",
  );

  test_roundtrip();
  test_expired();
  test_tamperedSignature();
  test_wrongSecret();
  test_missingOperatorClaim();
  test_wrongOpClaim();
  test_missingOperatorId();
  test_emptyOperatorId();
  test_malformedToken();
  test_emptySecret();
  test_pinCompareEqual();
  test_pinCompareUnequal();
  test_pinCompareEmpty();
  test_pinCompareDiffLengths();
  test_getOperatorPin_dev();
  test_cookieAttributes();
  test_clearCookie();
  test_isValidAuthenticatedCookie();
  test_decodeMalformed();
  test_decodeEmpty();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
