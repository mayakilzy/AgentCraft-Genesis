/**
 * AgentCraft Genesis G7 — UI State Store
 *
 * Single Zustand store for client-side state: active section, connection state,
 * mission context (selected missionId), and known missions (browser-local only).
 *
 * Per 03_UI_UX_CONTRACT.md §Navigation: persistent responsive shell with six
 * primary destinations. Direct links to mission/worker/artifact/event anchors
 * only when backend identifiers exist.
 *
 * Per 04_GATEWAY_DISCOVERY §Event contract: connectionState is kept SEPARATE
 * from mission status.
 */

import { create } from "zustand";
import type { ConnectionState } from "./client";
import type { MissionSnapshot } from "./types";

export type Section =
  | "work"
  | "agent"
  | "mission-control"
  | "artifacts"
  | "studio"
  | "insights";

export const SECTIONS: readonly {
  id: Section;
  label: string;
  description: string;
  /** Lucide icon name — resolved in component to keep this file side-effect-free. */
  icon: string;
}[] = [
  {
    id: "work",
    label: "Work",
    description: "Goal composer, submissions, mission list and outcome.",
    icon: "Target",
  },
  {
    id: "agent",
    label: "Agent",
    description: "Organization list/graph, roles, genomes, capabilities.",
    icon: "Users",
  },
  {
    id: "mission-control",
    label: "Mission Control",
    description: "Real-time mission lifecycle, timeline, worker actions.",
    icon: "Activity",
  },
  {
    id: "artifacts",
    label: "Artifacts & Replay",
    description: "Files, verification evidence, recorded-event replay.",
    icon: "FileText",
  },
  {
    id: "studio",
    label: "Studio",
    description: "Capabilities, skills, tools, integrations (read-only).",
    icon: "Wrench",
  },
  {
    id: "insights",
    label: "Insights",
    description: "Observed metrics, durations, failures, costs.",
    icon: "BarChart3",
  },
];

export interface KnownMission {
  /** The server-acknowledged mission ID. */
  missionId: string;
  /** ISO timestamp when the UI received the 202 ack. */
  firstSeenAt: string;
  /** Last snapshot we have (may be stale — UI shows "last observed at"). */
  lastSnapshot?: MissionSnapshot;
  /** ISO timestamp of the last successful snapshot fetch. */
  lastObservedAt?: string;
  /** Source: 'submit' (we created it in this session) | 'lookup' (we resolved by ID). */
  source: "submit" | "lookup";
}

export interface GenesisUiState {
  // Navigation
  activeSection: Section;
  setActiveSection: (s: Section) => void;

  // Connection
  connectionState: ConnectionState;
  setConnectionState: (s: ConnectionState) => void;
  lastConnectionCheckAt?: string;
  setLastConnectionCheckAt: (iso: string) => void;

  // Mission context (active selection)
  activeMissionId?: string;
  setActiveMissionId: (id: string | undefined) => void;

  // Known missions (browser-local only — no server list endpoint exists)
  knownMissions: Record<string, KnownMission>;
  upsertKnownMission: (m: KnownMission) => void;
  clearKnownMissions: () => void;

  // Environment / mode banner
  /** Mode banner flag. 'controlled' shows the test-environment banner. */
  genesisMode: "controlled" | "live";
}

export const useGenesisStore = create<GenesisUiState>((set) => ({
  activeSection: "work",
  setActiveSection: (s) => set({ activeSection: s }),

  connectionState: "connecting",
  setConnectionState: (s) => set({ connectionState: s }),
  setLastConnectionCheckAt: (iso) => set({ lastConnectionCheckAt: iso }),

  setActiveMissionId: (id) => set({ activeMissionId: id }),

  knownMissions: {},
  upsertKnownMission: (m) =>
    set((state) => ({
      knownMissions: { ...state.knownMissions, [m.missionId]: m },
    })),
  clearKnownMissions: () => set({ knownMissions: {} }),

  genesisMode:
    (process.env.NEXT_PUBLIC_GENESIS_MODE as "controlled" | "live" | undefined) ??
    "controlled",
}));
