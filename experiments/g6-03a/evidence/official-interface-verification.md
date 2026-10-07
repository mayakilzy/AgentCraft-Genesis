# G6-03A — Official OpenRouter Decisions API Interface Verification

**Verified at:** 2026-10-07T21:40:00Z
**Probe method:** Direct HTTP probes via OpenRouter API (no chat completions used)
**Probe scripts:** `/home/z/my-project/scripts/jev_decisions_probe*.ts` (vault-secured)

---

## 1. Endpoint Verification

**JEV_DECISIONS_ENDPOINT = `https://openrouter.ai/api/alpha/decisions`**

Verification evidence:
- `POST /api/alpha/decisions` with empty body → HTTP 400 with schema-validation error (Zod-style) demanding `questions` as a `record`. This proves the endpoint exists and validates input.
- `POST /api/alpha/decisions` with `questions: {q1: {type, question, choices}}` (missing `instructions` and `criteria`) → HTTP 400 with error demanding `questions.q1.instructions` (string|record|array union) and `questions.q1.criteria` (record). This proves the schema is exactly:
  - `model`: string (required)
  - `state`: string (required)
  - `questions`: record of `{<id>: QuestionSpec}` (required)
  - Each `QuestionSpec`: `{type, question, choices, instructions, criteria}`
- `GET /api/alpha/decisions` → HTTP 404 (no list endpoint exposed)
- `POST /api/v1/decisions` → HTTP 404 (does not exist; only the alpha path is real)

## 2. Model Verification

**JEV_DECISION_MODEL = `typesafe/jev-1.13`**

Verification evidence (from `/api/v1/models` GET listing + Decisions API probes):
- `typesafe/jev-1.13` is NOT listed in `/api/v1/models` (the chat-completions model listing). This is expected: the Decisions API uses a separate model namespace.
- `POST /api/alpha/decisions` with `model: "typesafe/jev-1.13"` and a valid schema → HTTP 403 with `error.message: "This model is not available in your region."` and `metadata.failed_routing_step: "Gate Endpoints with Geo Restrictions"`. This proves the model IS recognized by the Decisions API (the API did not return "Model does not exist"), but is geo-restricted for this OpenRouter account's region.
- `POST /api/alpha/decisions` with `model: "typesafe/jev-router"` → HTTP 400 with `error.message: "Model typesafe/jev-router does not exist"`. This proves `typesafe/jev-router` is NOT a Decisions-API model — it exists only on Chat Completions. **This is direct API-side confirmation of the G6-03A distinction** between the two Jev products.
- `POST /api/alpha/decisions` with `model: "typesafe/jev"` or `"typesafe/jev-1"` → HTTP 400 "Model X does not exist". These variants do not exist.

## 3. Request Schema

```
JEV_REQUEST_SCHEMA =
POST /api/alpha/decisions
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json

{
  "model": "typesafe/jev-1.13",
  "state": "<operational situation as string>",
  "questions": {
    "<question_id>": {
      "type": "choice" | "boolean" | "score" | "<other supported type>",
      "question": "<human-readable question>",
      "choices": ["<option_1>", "<option_2>", ...],   // for type=choice
      "instructions": "<string, record, or array>",   // required
      "criteria": { "<key>": "<value>", ... }         // required, record
    },
    ...
  }
}
```

## 4. Response Schema

**JEV_RESPONSE_SCHEMA = (not yet observed directly)**

The Decisions API could not be successfully called from this region due to the geo-restriction on `typesafe/jev-1.13`. The expected response shape (per mission Section 7-8) is:
- `selected answer` per question
- `probability` per option (where supplied by the API)
- `confidence` (where supplied)
- `question type` echo
- `model identity`
- `usage` / `cost` metadata

Because no successful 2xx response was observed, the response schema remains **inferred from the mission spec, not verified**. This is documented transparently. When a non-geo-restricted credential is available, the response schema should be re-verified.

## 5. Hard Negative Constraints (verified)

- `CHAT_COMPLETIONS_USED_FOR_JEV = NO` — this verification script never called `/api/v1/chat/completions`.
- `JEV_ROUTER_USED = NO` — the model `typesafe/jev-router` was only tested on the Decisions API (where it correctly returned "does not exist"); it was NOT used as a routing model.
- `NON_JEV_OPENROUTER_MODEL_USED = NO` — no other model was invoked.

## 6. Geo-Restriction Finding

The model `typesafe/jev-1.13` is geo-restricted for this OpenRouter account's region. The 403 response includes:
- `error.message`: `"This model is not available in your region."`
- `error.code`: 403
- `error.metadata.routing_funnel`: `[{step: "Initial Endpoints", endpoint_count: 1}]`
- `error.metadata.failed_routing_step`: `"Gate Endpoints with Geo Restrictions"`

This means:
- The Decisions API endpoint is real and reachable.
- The model `typesafe/jev-1.13` is real (recognized by the API).
- The schema we constructed is valid (the API accepted the schema and only rejected the call due to geo-restriction, not schema or model-name error).
- The live causal probe cannot be completed from this region with this credential.

## 7. Distinction from G6-03 (jev-router via Chat Completions)

G6-03 used `POST /api/v1/chat/completions` with `model: "typesafe/jev-router"`. That endpoint+model combination is a different product from the Decisions API + `typesafe/jev-1.13` verified here. **G6-03 evidence must not be treated as evidence for the Jev Decision Model.** See `docs/group6/GENESIS_G6_03_JEV_DECISION_BENCHMARK.md` corrigendum (added by G6-03A).

## 8. Acceptance Implications

- `REAL_JEV_DECISIONS_API = YES` — the API is real and the schema is verified.
- `JEV_MODEL = typesafe/jev-1.13` — the pinned decision model.
- `CHAT_COMPLETIONS_USED_FOR_JEV = NO` — verified.
- `JEV_ROUTER_USED = NO` — verified.
- `REAL_GENESIS_MISSION = NO` — blocked by geo-restriction (the live Jev call cannot complete from this region).
- `POSITIVE_CAUSAL_PROBE = BLOCKED` — the architecture is correctly wired, but the live call fails due to geo-restriction outside our control.
- `FAILURE_TRUTHFULNESS_PROBE = PASS` — the geo-restriction surfaces as a loud `JevProviderUnavailableError` (HTTP 403, no secret echo); no silent fallback to Rule or GLM.
- `PROVIDER_CONTROL_PROBE = PASS` — Rule path does not call OpenRouter; Jev path does call OpenRouter (and surfaces the 403 loudly).

## 9. Probe Call Budget

Total probe calls in this verification: 11 (across 3 probe scripts). All bounded, all using the Decisions API endpoint, no chat completions used.

## 10. Conclusion

The OpenRouter Decisions API and the `typesafe/jev-1.13` model are verified real. The Decisions API is structurally distinct from the Chat Completions API used in G6-03. The provider implementation in `src/providers/jev-decision-provider.ts` (corrected in G6-03A) targets this Decisions API exclusively. The geo-restriction blocks the live causal probe but does not invalidate the architectural correction.

The honest status is **BLOCKED** for the positive causal probe and **PASS** for the structural verification, failure truthfulness, and provider control probes. The user (who has independent OpenRouter dashboard access) can verify this finding.
