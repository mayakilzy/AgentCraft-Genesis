"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Code2,
  FileText,
  HelpCircle,
  Loader2,
  Package,
  Search,
  ShieldOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface CapabilityCardData {
  key: string;
  name: string;
  owner: string;
  domain: string;
  source: string;
  upstreamProject?: string;
  sourceUrl?: string;
  decision: string;
  upstreamStatus?: string;
  futureValue?: string;
  status: "DOCUMENTED" | "INTEGRATED" | "RUNTIME_VERIFIED";
  evidence: string;
  notes: string;
  satisfies?: readonly string[];
}

interface CatalogResponse {
  ok: boolean;
  ownership: CapabilityCardData[];
  census: CapabilityCardData[];
  errors: string[];
  source: string;
  runtimeVerifiedCount: number;
  integratedCount: number;
  documentedCount: number;
}

const STATUS_META: Record<
  CapabilityCardData["status"],
  { label: string; icon: typeof CheckCircle2; tone: string; description: string }
> = {
  DOCUMENTED: {
    label: "Documented",
    icon: FileText,
    tone: "bg-muted text-muted-foreground border-border",
    description:
      "The capability appears in a YAML source file. No source-code wiring or runtime probe has verified it.",
  },
  INTEGRATED: {
    label: "Integrated",
    icon: Code2,
    tone: "bg-primary/10 text-primary border-primary/30",
    description:
      "The capability is verified as wired into the engine source code (actual import/adapter). Runtime behavior not verified.",
  },
  RUNTIME_VERIFIED: {
    label: "Runtime verified",
    icon: CheckCircle2,
    tone: "bg-success/15 text-success border-success/30",
    description:
      "The capability has been verified at runtime via an actual probe. NOT achievable in the controlled environment.",
  },
};

/**
 * StudioCatalog — searchable, filterable capability catalog.
 *
 * Per G7-05 acceptance:
 *   1. Uses data/ownership.yaml + data/upstream-capabilities.yaml as
 *      documented sources only.
 *   2. Distinguishes DOCUMENTED / INTEGRATED / RUNTIME_VERIFIED.
 *      RUNTIME_VERIFIED is NEVER claimed (requires runtime probing).
 *   3. Cards show: name, owner, domain, source, evidence, honest availability.
 *   4. No /capabilities gateway endpoint invented.
 *   5. No Install/Connect/Enable/Execute actions.
 *   6. Read-only — no second capability registry or plugin manager.
 *   7. Loaded through controlled server-side path (/api/studio/catalog).
 */
export function StudioCatalog() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;
    const load = async () => {
      if (cancelled) return;
      setState("loading");
      try {
        const res = await fetch("/api/studio/catalog", {
          method: "GET",
          credentials: "include",
          signal: controller.signal,
        });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as CatalogResponse;
          setCatalog(data);
          setState("loaded");
        } else {
          setState("error");
          setErrorMsg(`Failed to load catalog (status ${res.status}).`);
        }
      } catch (e) {
        if (cancelled) return;
        setState("error");
        setErrorMsg(e instanceof Error ? e.message : "Network error.");
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // Build filter options from the loaded data.
  const allCards = useMemo(() => {
    if (!catalog) return [];
    return [...catalog.ownership, ...catalog.census];
  }, [catalog]);

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCards) {
      set.add(c.owner);
    }
    return Array.from(set).sort();
  }, [allCards]);

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCards) {
      set.add(c.source);
    }
    return Array.from(set).sort();
  }, [allCards]);

  const filteredCards = useMemo(() => {
    const lower = search.toLowerCase().trim();
    return allCards.filter((c) => {
      if (ownerFilter !== "all" && c.owner !== ownerFilter) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (sourceFilter !== "all" && c.source !== sourceFilter) return false;
      if (lower.length > 0) {
        const haystack = [
          c.name,
          c.domain,
          c.owner,
          c.decision,
          c.notes,
          c.evidence,
          c.upstreamProject ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(lower)) return false;
      }
      return true;
    });
  }, [allCards, search, ownerFilter, statusFilter, sourceFilter]);

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-3">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        <span>Loading capability catalog…</span>
      </div>
    );
  }

  if (state === "error" && errorMsg) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
      >
        {errorMsg}
      </div>
    );
  }

  if (!catalog) return null;

  return (
    <div className="space-y-4">
      {/* Honest notice: documentation only */}
      <div
        role="note"
        className="rounded-md border border-info/30 bg-info/5 p-2 text-[11px] text-info flex items-start gap-1.5"
      >
        <ShieldOff className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <strong>Documentation only — not runtime discovery.</strong> The
          gateway has no <code className="font-mono">/capabilities</code>{" "}
          endpoint in v1. This catalog is loaded from the controlled{" "}
          <code className="font-mono">data/</code> directory (YAML files).
          Statuses are DOCUMENTED (YAML only) or INTEGRATED (verified source
          wiring). RUNTIME_VERIFIED requires actual runtime probing and is NOT
          claimed. No Install / Connect / Enable / Execute actions — read-only.
        </div>
      </div>

      {/* Errors from YAML loading (malformed entries, missing fields, duplicates) */}
      {catalog.errors.length > 0 && (
        <details className="rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-warning">
          <summary className="cursor-pointer font-medium">
            {catalog.errors.length} parsing notice
            {catalog.errors.length === 1 ? "" : "s"} (malformed YAML, missing
            fields, or duplicates — show details)
          </summary>
          <ul className="mt-2 space-y-0.5 list-disc list-inside">
            {catalog.errors.map((err, i) => (
              <li key={i} className="font-mono">{err}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <SummaryStat
          label="Documented"
          count={catalog.documentedCount}
          tone="text-muted-foreground"
        />
        <SummaryStat
          label="Integrated"
          count={catalog.integratedCount}
          tone="text-primary"
        />
        <SummaryStat
          label="Runtime verified"
          count={catalog.runtimeVerifiedCount}
          tone="text-muted-foreground/60 italic"
        />
      </div>

      {/* Filters */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="studio-search" className="text-[11px] font-medium">
            Search
          </Label>
          <div className="relative">
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="studio-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="name, domain, owner…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="studio-owner" className="text-[11px] font-medium">
            Owner
          </Label>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger id="studio-owner" className="h-8 text-xs">
              <SelectValue placeholder="All owners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {ownerOptions.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="studio-status" className="text-[11px] font-medium">
            Status
          </Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="studio-status" className="h-8 text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="DOCUMENTED">Documented</SelectItem>
              <SelectItem value="INTEGRATED">Integrated</SelectItem>
              <SelectItem value="RUNTIME_VERIFIED">
                Runtime verified (always 0)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="studio-source" className="text-[11px] font-medium">
            Source
          </Label>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger id="studio-source" className="h-8 text-xs">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sourceOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results count */}
      <p className="text-[11px] text-muted-foreground">
        Showing {filteredCards.length} of {allCards.length} capabilities.
      </p>

      {/* Cards */}
      {filteredCards.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No capabilities match the current filters.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCards.map((c) => (
            <CapabilityCard key={`${c.source}-${c.key}`} card={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("text-lg font-semibold", tone)}>{count}</p>
    </div>
  );
}

function CapabilityCard({ card }: { card: CapabilityCardData }) {
  const meta = STATUS_META[card.status];
  const Icon = meta.icon;
  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-medium truncate" title={card.name}>
            {card.name}
          </h3>
          <p className="text-[10px] text-muted-foreground font-mono truncate" title={card.domain}>
            {card.domain}
          </p>
        </div>
        <Badge
          className={cn("shrink-0 gap-1", meta.tone)}
          aria-label={`Status: ${meta.label}`}
        >
          <Icon className="size-3" aria-hidden="true" />
          {meta.label}
        </Badge>
      </div>

      <div className="space-y-1 text-[11px]">
        <Field label="Owner" value={card.owner} />
        <Field label="Decision" value={card.decision} />
        {card.upstreamProject && (
          <Field label="Upstream" value={card.upstreamProject} />
        )}
        {card.upstreamStatus && (
          <Field label="Upstream status" value={card.upstreamStatus} />
        )}
        {card.futureValue && (
          <Field label="Future value" value={card.futureValue} />
        )}
        <Field label="Source" value={card.source} mono />
        <Field label="Evidence" value={card.evidence} mono />
        {card.satisfies && card.satisfies.length > 0 && (
          <Field
            label="Satisfies"
            value={card.satisfies.join(", ")}
            mono
          />
        )}
      </div>

      {card.notes && (
        <p className="text-[10px] text-muted-foreground border-t border-border pt-1">
          {card.notes}
        </p>
      )}

      {card.sourceUrl && (
        <a
          href={card.sourceUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
          aria-label={`View upstream source: ${card.sourceUrl}`}
        >
          <Package className="size-3" aria-hidden="true" />
          Upstream reference
        </a>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | undefined;
  mono?: boolean;
}) {
  if (value === undefined || value.length === 0) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground w-24 shrink-0 text-[10px] uppercase tracking-wide">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 break-words",
          mono && "font-mono text-[10px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// Re-export for parent.
export { HelpCircle };
