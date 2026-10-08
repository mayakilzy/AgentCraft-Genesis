"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  FileText,
  Menu,
  Target,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useGenesisStore, SECTIONS, type Section } from "@/lib/genesis/store";
import { ConnectionStatus } from "./ConnectionStatus";
import { EnvironmentStatus } from "./EnvironmentStatus";
import { MissionBreadcrumb } from "./MissionBreadcrumb";

const ICON_MAP: Record<string, typeof Target> = {
  Target,
  Users,
  Activity,
  FileText,
  Wrench,
  BarChart3,
};

interface NavListProps {
  onNavigate?: () => void;
}

function NavList({ onNavigate }: NavListProps) {
  const activeSection = useGenesisStore((s) => s.activeSection);
  const setActiveSection = useGenesisStore((s) => s.setActiveSection);

  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      {SECTIONS.map((s, idx) => {
        const Icon = ICON_MAP[s.icon] ?? Target;
        const active = activeSection === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={active ? "page" : undefined}
            aria-label={`${s.label}. ${s.description}. Alt+${idx + 1}`}
            title={`${s.description} (Alt+${idx + 1})`}
            onClick={() => {
              setActiveSection(s.id as Section);
              onNavigate?.();
            }}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
              "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * AppShell — persistent responsive navigation with six destinations.
 *
 * Layout (per 08_DESIGN_SYSTEM §Page composition + 03_UI_UX_CONTRACT §Navigation):
 *   - Desktop >=1024: left rail nav + page title + connection state.
 *   - Tablet 640–1023: compact nav (collapsible) + detail.
 *   - Mobile <640: collapsible nav (Sheet), stacked cards.
 *
 * Keyboard-first: each nav item is a button with proper ARIA + visible focus.
 * RTL-ready: uses logical CSS (ml-*, mr-*) and `dir` attribute inheritance.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const setActiveSection = useGenesisStore((s) => s.setActiveSection);
  const sheetOpenRef = useRef(false);

  // Keyboard shortcut: Alt+1..6 to jump between sections (WCAG-friendly).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && /^Digit[1-6]$/.test(e.key)) {
        const idx = parseInt(e.key.slice(-1), 10) - 1;
        const target = SECTIONS[idx];
        if (target) {
          setActiveSection(target.id);
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setActiveSection]);

  // Acquire the BFF session cookie on mount. The /api/genesis/* proxy
  // requires this cookie — without it, every call returns 401.
  // The /api/auth/setup endpoint is idempotent: if a valid cookie is already
  // present, it returns 200 without re-issuing.
  const setBffReady = useGenesisStore((s) => s.setBffReady);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/setup", {
          method: "GET",
          credentials: "include",
        });
        if (cancelled) return;
        if (res.ok) {
          // Cookie is set (or was already). Signal ConnectionStatus to begin polling.
          setBffReady(true);
        } else {
          // The cookie wasn't issued. The UI will see 401 on subsequent
          // /api/genesis/* calls and show the unauthorized state honestly.
          console.warn(
            "[genesis-shell] BFF cookie setup failed:",
            res.status,
          );
          setBffReady(true); // still allow polling so the UI shows the 401 truthfully
        }
      } catch (e) {
        if (cancelled) return;
        console.warn("[genesis-shell] BFF cookie setup error:", e);
        setBffReady(true); // allow polling so we see the real failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setBffReady]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Top bar — present on all viewports. */}
      <header
        className="flex items-center gap-3 border-b border-border bg-card px-4 py-3"
        role="banner"
      >
        {/* Mobile nav trigger */}
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open navigation"
              aria-keyshortcuts="Alt+M"
              // size-11 = 44px — meets WCAG 2.2 AA touch target recommendation
              className="inline-flex size-11 items-center justify-center rounded-md text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring md:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[260px] p-0">
            <SheetTitle className="sr-only">
              AgentCraft Genesis navigation
            </SheetTitle>
            <SheetDescription className="sr-only">
              Choose one of the six product destinations: Work, Agent, Mission
              Control, Artifacts &amp; Replay, Studio, or Insights. Each item
              can also be reached with Alt and the number 1 through 6.
            </SheetDescription>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold">Sections</span>
              <SheetClose asChild>
                <button
                  type="button"
                  aria-label="Close navigation"
                  className="inline-flex size-8 items-center justify-center rounded-md text-foreground hover:bg-accent"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </SheetClose>
            </div>
            <NavList
              onNavigate={() => {
                sheetOpenRef.current = false;
              }}
            />
          </SheetContent>
        </Sheet>

        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
          >
            <Target className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold sm:text-base">
            AgentCraft <span className="text-muted-foreground">Genesis</span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <MissionBreadcrumb />
          <EnvironmentStatus />
          <ConnectionStatus />
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        {/* Desktop left rail */}
        <aside
          className="hidden w-[240px] shrink-0 border-r border-border bg-sidebar text-sidebar-foreground md:block"
          aria-label="Sidebar navigation"
        >
          <NavList />
        </aside>

        {/* Main content */}
        <main
          id="main"
          className="flex-1 overflow-x-hidden p-4 sm:p-6"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>

      <footer
        className="mt-auto border-t border-border bg-card px-4 py-2 text-xs text-muted-foreground"
        role="contentinfo"
      >
        <span>
          AgentCraft Genesis G7 · Gateway client UI · Evidence-first · Controlled
          test environment
        </span>
      </footer>
    </div>
  );
}
