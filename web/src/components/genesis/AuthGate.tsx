"use client";

import { useState } from "react";
import { Lock, Loader2, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AuthGateProps {
  /** Called when the operator successfully authenticates. */
  onAuthenticated: () => void;
}

/**
 * AuthGate — operator authentication screen.
 *
 * Per G7-02 Independent Review: the BFF cookie is only issued by POST
 * /api/auth/login after a server-validated operator PIN. This component
 * collects the PIN from the user and submits it.
 *
 * Trust boundary (documented):
 *   - The PIN is the SOLE trust boundary. Anyone with the PIN can mint a BFF
 *     session. Suitable for controlled environments with operator-only
 *     network access.
 *   - The PIN is constant-time compared server-side. We do not reveal
 *     whether the failure was "wrong PIN" or "server misconfigured".
 *   - G7-15A: a server-side rate limiter bounds online PIN brute-force
 *     (5 failed attempts per 60s per key). The limiter key does NOT trust
 *     client-supplied forwarding headers by default. See
 *     `web/src/lib/auth/rate-limit.ts` for the trust model.
 *
 * G7-15A reconciliation (G7-08D): the `devModeHint` prop and the
 * `dev-local-pin` placeholder/hint block were removed. The dev-mode PIN
 * default (`dev-local-pin`) is a SERVER-SIDE convenience implemented in
 * `getOperatorPin()` — it is never surfaced to the client. This is the
 * "remove inappropriate development hints from production AuthGate" item:
 * the AuthGate renders identically in dev and production, with a generic
 * "Operator PIN" placeholder. The server-side dev PIN default is unchanged
 * (it is not a secret and not exposed through the UI).
 *
 * Single-operator model: not multi-user isolation. All sessions share the
 * gateway's callerId via GENESIS_API_KEY.
 */
export function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [pin, setPin] = useState("");
  const [state, setState] = useState<
    "idle" | "loading" | "error" | "unavailable"
  >("idle");
  const [error, setError] = useState<string | undefined>();

  const login = async () => {
    if (pin.length === 0) {
      setState("error");
      setError("Enter the operator PIN.");
      return;
    }
    setState("loading");
    setError(undefined);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
        credentials: "include",
      });
      if (res.ok) {
        onAuthenticated();
        return;
      }
      // 401 INVALID_PIN, 400 MISSING_PIN/INVALID_JSON, 429 TOO_MANY_ATTEMPTS,
      // 503 BFF_PIN_NOT_CONFIGURED. We deliberately do NOT distinguish 401
      // from 503 to avoid leaking that the server is misconfigured. Both
      // surface as a generic "Invalid PIN" error. The 503 case is handled
      // by surfacing a distinct message.
      if (res.status === 400) {
        let body: { error?: { code?: string; message?: string } } = {};
        try {
          body = await res.json();
        } catch {
          // ignore
        }
        setState("error");
        setError(body.error?.message ?? "PIN is required.");
      } else if (res.status === 401) {
        setState("error");
        setError("Invalid PIN. Try again.");
      } else if (res.status === 429) {
        // G7-15A: rate-limited. Surface a distinct message so the operator
        // knows to wait — but do NOT leak how many attempts remain (that
        // would let an attacker calibrate their flood rate).
        setState("error");
        setError("Too many failed attempts. Wait a minute and try again.");
      } else if (res.status === 503) {
        setState("unavailable");
        setError(
          "Server is not configured for operator authentication (GENESIS_OPERATOR_PIN not set in production). Contact the operator.",
        );
      } else {
        setState("error");
        setError(`Login failed (status ${res.status}).`);
      }
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Network error.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto">
            <Lock className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold">AgentCraft Genesis</h1>
          <p className="text-xs text-muted-foreground">
            Operator authentication required. The BFF proxy attaches the
            privileged Gateway API key only to authenticated sessions.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="operator-pin" className="text-sm">
            Operator PIN
          </Label>
          <Input
            id="operator-pin"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && state !== "loading") {
                e.preventDefault();
                void login();
              }
            }}
            disabled={state === "loading"}
            autoComplete="off"
            placeholder="Operator PIN"
            aria-invalid={state === "error" ? "true" : undefined}
            aria-describedby={error ? "pin-error" : undefined}
            className="font-mono"
          />
          {state === "error" && error && (
            <p
              id="pin-error"
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-1.5 text-xs text-destructive"
            >
              <AlertCircle
                className="size-3.5 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>{error}</span>
            </p>
          )}
          {state === "unavailable" && error && (
            <p
              id="pin-error"
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-1.5 text-xs text-warning"
            >
              <AlertCircle
                className="size-3.5 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>{error}</span>
            </p>
          )}
        </div>

        <Button
          type="button"
          onClick={() => void login()}
          disabled={state === "loading" || pin.length === 0}
          className="w-full gap-1.5"
        >
          {state === "loading" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-4" aria-hidden="true" />
          )}
          Authenticate
        </Button>

        <p className="text-[11px] text-muted-foreground text-center">
          The PIN is server-validated with constant-time comparison. Sessions
          are HMAC-signed, HttpOnly, SameSite=Strict, bounded to 8 hours. The
          BFF cookie carries an <code className="font-mono">op=operator</code>{" "}
          claim — without it, /api/genesis/* returns 401. Single-operator model:
          no multi-user isolation; all sessions share the gateway&apos;s
          callerId.
        </p>
      </div>
    </div>
  );
}
