"use client";

import { AppShell } from "@/components/genesis/AppShell";
import { EnvironmentBanner } from "@/components/genesis/EnvironmentStatus";
import {
  AgentSection,
  ArtifactsSection,
  InsightsSection,
  MissionControlSection,
  StudioSection,
  WorkSection,
} from "@/components/genesis/sections/Sections";
import { useGenesisStore } from "@/lib/genesis/store";

/**
 * G7-01 — Shell + verified gateway contracts.
 *
 * Single-page application with six destinations. Section switching is state-driven
 * via Zustand (the sandbox preview exposes only the `/` route, so we treat the
 * six destinations as in-app sections rather than separate routes).
 *
 * Per 02_PRODUCT_SPECIFICATION §Golden journey: user opens Work, connection is
 * checked; if gateway unavailable, show explicit unavailable state and retry.
 *
 * Per 08_DESIGN_SYSTEM §Page composition: shell = persistent nav + page title/
 * context + connection state. Per §Responsive behavior: 360–639 stacked +
 * drawer nav; 640–1023 compact; >=1024 rail nav + contextual split panes.
 */
export default function Home() {
  const activeSection = useGenesisStore((s) => s.activeSection);
  return (
    <AppShell>
      <EnvironmentBanner />
      {activeSection === "work" && <WorkSection />}
      {activeSection === "agent" && <AgentSection />}
      {activeSection === "mission-control" && <MissionControlSection />}
      {activeSection === "artifacts" && <ArtifactsSection />}
      {activeSection === "studio" && <StudioSection />}
      {activeSection === "insights" && <InsightsSection />}
    </AppShell>
  );
}
