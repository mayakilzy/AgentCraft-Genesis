"use client";

import { useEffect, useState } from "react";
import { Loader2, Target } from "lucide-react";
import { AppShell } from "@/components/genesis/AppShell";
import { AuthGate } from "@/components/genesis/AuthGate";
import { EnvironmentBanner } from "@/components/genesis/EnvironmentStatus";
import { ProjectsSection } from "@/components/genesis/ProjectsSection";
import {
  AgentSection,
  ArtifactsSection,
  InsightsSection,
  MissionControlSection,
  StudioSection,
  WorkSection,
} from "@/components/genesis/sections/Sections";
import { HomeSection } from "@/components/genesis/HomeSection";
import { useGenesisStore } from "@/lib/genesis/store";

/**
 * GenesisApp — top-level client component that handles auth state.
 *
 * On mount, it pings /api/genesis/health to determine if the BFF cookie is
 * operator-authenticated:
 *   - 401 → unauthenticated → render <AuthGate>
 *   - 200 / 503 / anything else → authenticated (the cookie was accepted)
 *
 * Per G7-02 Independent Review: the auth check piggybacks on the BFF itself.
 * We do NOT call a separate /auth/status endpoint — the BFF's 401 response
 * is the single source of truth for "you are not authenticated".
 *
 * Once authenticated (cookie issued by /api/auth/login), the page renders
 * <AppShell> and signals `bffReady` to the store so ConnectionStatus can
 * begin polling.
 */
type AuthState = "checking" | "authenticated" | "unauthenticated";

export function GenesisApp() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const setBffReady = useGenesisStore((s) => s.setBffReady);
  const activeSection = useGenesisStore((s) => s.activeSection);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/genesis/health", {
          method: "GET",
          credentials: "include",
        });
        if (cancelled) return;
        if (res.status === 401) {
          setAuthState("unauthenticated");
        } else {
          // 200 (gateway up) or 503 (gateway down) — either way, the BFF
          // accepted our cookie, so we are authenticated.
          setAuthState("authenticated");
          setBffReady(true);
        }
      } catch {
        if (cancelled) return;
        // Network error — we can't tell if we're authenticated. Default to
        // unauthenticated so the user sees the AuthGate (the worst case is
        // they enter the PIN unnecessarily; the worst case the other way is
        // showing the app with no working backend).
        setAuthState("unauthenticated");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setBffReady]);

  if (authState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <span
            aria-hidden="true"
            className="inline-flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground"
          >
            <Target className="size-5" aria-hidden="true" />
          </span>
          <span>Verifying session…</span>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <AuthGate
        onAuthenticated={() => {
          setAuthState("authenticated");
          setBffReady(true);
        }}
      />
    );
  }

  return (
    <AppShell>
      <EnvironmentBanner />
      {activeSection === "home" && <HomeSection />}
      {activeSection === "projects" && <ProjectsSection />}
      {activeSection === "work" && <WorkSection />}
      {activeSection === "agent" && <AgentSection />}
      {activeSection === "mission-control" && <MissionControlSection />}
      {activeSection === "artifacts" && <ArtifactsSection />}
      {activeSection === "studio" && <StudioSection />}
      {activeSection === "insights" && <InsightsSection />}
    </AppShell>
  );
}
