"use client";

import { GenesisApp } from "@/components/genesis/GenesisApp";

/**
 * G7-01..02 — Shell + verified gateway contracts + Work & Goal Composer.
 *
 * The GenesisApp component handles the auth state and renders <AuthGate>
 * (PIN entry) when the BFF cookie is not operator-authenticated, or
 * <AppShell> with the active section when authenticated.
 *
 * Per 02_PRODUCT_SPECIFICATION §Golden journey: user opens Work, connection
 * is checked; if gateway unavailable, show explicit unavailable state and
 * retry. Per G7-02 Independent Review: the auth check is the BFF's 401
 * response itself — anonymous callers cannot mint privileged cookies.
 */
export default function Home() {
  return <GenesisApp />;
}
