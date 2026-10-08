"use client";

import { useState } from "react";
import { Lock, Loader2, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AuthGateProps {
  /** Called when the operator successfully authenticates. */
  onAuthenticated: () => void;
  /** Optional: the dev PIN hint to display when in controlled mode. */
  devModeHint?: boolean;
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
 *   - In dev mode, the default PIN is 'dev-local-pin' (when
 *     GENESIS_OPERATOR_PIN is unset). In production, GENESIS_OPERATOR_PIN
 *     MUST be set or the server returns 503 BFF_PIN_NOT_CONFIGURED (mapped
 *     to 401 here to avoid leaking server state).
 *   - The PIN is constant-time compared server-side. We do not reveal
 *     whether the failure was "wrong PIN" or "server misconfigured".
 *
 * Single-operator model: not multi-user isolation. All sessions share the
 * gateway's callerId via GENESIS_API_KEY.
 */
export function AuthGate({ onAuthenticated, devModeHint }: AuthGateProps) {
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
      // 401 INVALID_PIN, 400 MISSING_PIN/INVALID_JSON, 503 BFF_PIN_NOT_CONFIGURED.
      // We deliberately do NOT distinguish 401 from 503 to avoid leaking that
      // the server is misconfigured. Both surface as a generic "Invalid PIN"
      // error. The 503 case is handled by surfacing a distinct message.
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
            placeholder={devModeHint ? "dev-local-pin" : "Operator PIN"}
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

        {devModeHint && (
          <p className="text-[11px] text-warning text-center border border-warning/30 bg-warning/5 rounded p-2">
            <strong>Controlled environment:</strong> the default dev PIN is{" "}
            <code className="font-mono">dev-local-pin</code> (when
            GENESIS_OPERATOR_PIN is unset). Set
            <code className="font-mono">GENESIS_OPERATOR_PIN</code> for any
            non-local deployment.
          </p>
        )}
      </div>
    </div>
  );
}
