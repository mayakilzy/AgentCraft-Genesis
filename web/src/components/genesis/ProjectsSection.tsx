"use client";

// The react-hooks/set-state-in-effect rule flags async data-fetching effects
// that call setState after await. This is the standard polling pattern used
// throughout the Genesis UI. We disable it file-wide to avoid noise.
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  FolderKanban,
  Plus,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Save,
  RefreshCw,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { genesisApi } from "@/lib/genesis/client";
import { useGenesisStore } from "@/lib/genesis/store";
import type {
  ProjectBrief,
  ProjectListResult,
  ProjectOverview,
  ProjectRecord,
  ProjectSummary,
  BriefEntry,
  BriefProvenance,
} from "@/lib/genesis/types";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 5000;

/**
 * ProjectsSection — G7-13 Durable Projects Repository UI.
 *
 * Two main views:
 *   - List view: shows the caller's projects, supports creating a new project.
 *   - Detail view: shows project overview + Brief editor + linked
 *     conversations/missions/artifacts.
 *
 * Switching between projects does NOT leak data — components re-fetch on
 * activeProjectId change. Loading, empty, error, and conflict states are
 * explicit. Brief drafts are visually distinguished from approved decisions.
 *
 * Truthful unavailable states: after Gateway restart, mission state is
 * shown as UNAVAILABLE (not fabricated); artifact references that can no
 * longer be re-verified are shown as MISSING/UNAVAILABLE.
 */
export function ProjectsSection() {
  const activeProjectId = useGenesisStore((s) => s.activeProjectId);
  const setActiveProjectId = useGenesisStore((s) => s.setActiveProjectId);

  if (activeProjectId === undefined) {
    return <ProjectsListView onSelect={(id) => setActiveProjectId(id)} />;
  }
  return (
    <ProjectDetailView
      projectId={activeProjectId}
      onBack={() => setActiveProjectId(undefined)}
    />
  );
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function ProjectsListView({ onSelect }: { onSelect: (id: string) => void }) {
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const fetchList = useCallback(async () => {
    const res = await genesisApi.listProjects({ limit: 50 });
    if (res.kind === "ok" && res.data) {
      setProjects(res.data.projects);
      setError(undefined);
    } else if (res.kind === "unauthorized") {
      setError("Authentication required. Please log in.");
    } else if (res.kind === "unavailable") {
      setError(res.message ?? "Gateway unavailable.");
    } else {
      setError(res.message ?? "Failed to load projects.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const handleCreate = async () => {
    const trimmedName = newName.trim();
    if (trimmedName.length === 0) return;
    setCreating(true);
    setError(undefined);
    const idempotencyKey = `proj-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await genesisApi.createProject({
      name: trimmedName,
      description: newDescription.trim() || undefined,
      idempotencyKey,
      brief: { objective: newDescription.trim() || undefined },
    });
    if (res.kind === "ok" && res.data) {
      setNewName("");
      setNewDescription("");
      await fetchList();
      onSelect(res.data.projectId);
    } else {
      setError(res.message ?? "Project creation failed.");
    }
    setCreating(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <FolderKanban className="size-5 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Projects</h1>
        <span className="text-xs text-muted-foreground">
          Durable workspaces for organizing conversations, missions, and artifacts.
        </span>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Create a new project</CardTitle>
          <CardDescription>
            Creating a project does NOT start a mission or trigger execution. You can
            describe the project&apos;s objective and constraints now; approved decisions
            are recorded separately.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            placeholder="Project name (e.g., Customer feedback analysis)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={200}
            disabled={creating}
            aria-label="Project name"
          />
          <Textarea
            placeholder="Short description or initial objective (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            maxLength={2000}
            rows={3}
            disabled={creating}
            aria-label="Project description"
          />
          <Button
            onClick={handleCreate}
            disabled={creating || newName.trim().length === 0}
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            Create project
          </Button>
        </CardContent>
      </Card>

      {error !== undefined && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <span>Loading projects…</span>
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <FolderKanban className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No projects yet. Create your first project above to start organizing
              conversations and missions over time.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.projectId} project={p} onSelect={() => onSelect(p.projectId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  onSelect,
}: {
  project: ProjectSummary;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="flex h-auto flex-col items-start gap-2 p-4 text-left"
      onClick={onSelect}
    >
      <div className="flex w-full items-center gap-2">
        <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate font-medium">{project.name}</span>
        {project.status === "archived" && (
          <span className="ml-auto rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            archived
          </span>
        )}
      </div>
      {project.description.length > 0 && (
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {project.description}
        </span>
      )}
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span>{project.conversationCount} conversations</span>
        <span>{project.missionCount} missions</span>
        <span>{project.artifactCount} artifacts</span>
      </div>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function ProjectDetailView({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const [overview, setOverview] = useState<ProjectOverview | undefined>();
  const [project, setProject] = useState<ProjectRecord | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const setActiveConversationId = useGenesisStore((s) => s.setActiveConversationId);
  const setActiveSection = useGenesisStore((s) => s.setActiveSection);
  const abortRef = useRef<AbortController | null>(null);

  const fetchAll = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const [overviewRes, projectRes] = await Promise.all([
      genesisApi.getProjectOverview(projectId, controller.signal),
      genesisApi.getProject(projectId, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    if (overviewRes.kind === "ok" && overviewRes.data) {
      setOverview(overviewRes.data);
      setError(undefined);
    } else if (overviewRes.kind === "unavailable") {
      setError(overviewRes.message ?? "Gateway unavailable.");
    } else if (overviewRes.kind === "unauthorized") {
      setError("Authentication required.");
    } else {
      setError(overviewRes.message ?? "Failed to load overview.");
    }
    if (projectRes.kind === "ok" && projectRes.data) {
      setProject(projectRes.data);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void fetchAll();
    const interval = setInterval(() => void fetchAll(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading && overview === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <span>Loading project…</span>
      </div>
    );
  }

  if (overview === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="w-fit">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to projects
        </Button>
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span>{error ?? "Project could not be loaded."}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="w-fit">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to projects
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void fetchAll()}
          className="w-fit"
          aria-label="Refresh project"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <FolderKanban className="size-5 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-semibold">{overview.project.name}</h1>
          {overview.project.status === "archived" && (
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              archived
            </span>
          )}
        </div>
        {overview.project.description.length > 0 && (
          <p className="text-sm text-muted-foreground">{overview.project.description}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Created {new Date(overview.project.createdAt).toLocaleString()} · Last activity{" "}
          {new Date(overview.latestActivityAt).toLocaleString()}
        </p>
      </header>

      {error !== undefined && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <BriefEditor projectId={projectId} brief={overview.brief} />

      <RelationshipsGrid
        overview={overview}
        onOpenConversation={(conversationId) => {
          setActiveConversationId(conversationId);
          setActiveSection("home");
        }}
      />

      {project !== undefined && <ProjectMetadataEditor project={project} onChanged={fetchAll} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brief editor (revision-controlled, draft vs approved distinction)
// ---------------------------------------------------------------------------

function BriefEditor({
  projectId,
  brief,
}: {
  projectId: string;
  brief: ProjectBrief;
}) {
  const [revision, setRevision] = useState(brief.revision);
  const [objective, setObjective] = useState(brief.objective);
  const [requirements, setRequirements] = useState(brief.requirements.join("\n"));
  const [constraints, setConstraints] = useState(brief.constraints.join("\n"));
  const [nextSteps, setNextSteps] = useState(brief.nextSteps.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [conflict, setConflict] = useState<string | undefined>();
  const [successAt, setSuccessAt] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  // Re-sync when the brief changes server-side (e.g., after refresh or after
  // a successful save returns the new revision).
  useEffect(() => {
    setRevision(brief.revision);
    setObjective(brief.objective);
    setRequirements(brief.requirements.join("\n"));
    setConstraints(brief.constraints.join("\n"));
    setNextSteps(brief.nextSteps.join("\n"));
  }, [brief]);

  const handleSave = async () => {
    setSaving(true);
    setError(undefined);
    setConflict(undefined);
    setSuccessAt(undefined);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const splitLines = (s: string) =>
      s
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const res = await genesisApi.updateBrief(
      projectId,
      {
        revision,
        objective,
        requirements: splitLines(requirements),
        constraints: splitLines(constraints),
        nextSteps: splitLines(nextSteps),
      },
      controller.signal,
    );
    if (res.kind === "ok" && res.data) {
      setRevision(res.data.brief.revision);
      setObjective(res.data.brief.objective);
      setRequirements(res.data.brief.requirements.join("\n"));
      setConstraints(res.data.brief.constraints.join("\n"));
      setNextSteps(res.data.brief.nextSteps.join("\n"));
      setSuccessAt(new Date().toISOString());
    } else if (res.code === "BRIEF_REVISION_CONFLICT") {
      setConflict(
        res.message ??
          "Brief was modified elsewhere. Refresh the project to load the latest revision.",
      );
    } else {
      setError(res.message ?? "Failed to save Brief.");
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Brief</CardTitle>
        <CardDescription>
          The Brief is the project&apos;s durable, revision-controlled context. Drafts are
          visually distinct from approved decisions — never silently promoted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="brief-objective" className="text-xs font-medium text-muted-foreground">
            Objective
          </label>
          <Textarea
            id="brief-objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={2}
            maxLength={2000}
            disabled={saving}
            placeholder="What outcome is this project driving toward?"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <BriefListEditor
            label="Requirements"
            value={requirements}
            onChange={setRequirements}
            disabled={saving}
            placeholder="One requirement per line"
          />
          <BriefListEditor
            label="Constraints"
            value={constraints}
            onChange={setConstraints}
            disabled={saving}
            placeholder="One constraint per line"
          />
          <BriefListEditor
            label="Next steps"
            value={nextSteps}
            onChange={setNextSteps}
            disabled={saving}
            placeholder="One next step per line"
          />
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              Approved decisions (read-only)
            </label>
            <div className="rounded-md border bg-muted/20 p-3 text-xs">
              {brief.approvedDecisions.length === 0 ? (
                <span className="text-muted-foreground">No approved decisions yet.</span>
              ) : (
                <ul className="flex flex-col gap-2">
                  {brief.approvedDecisions.map((d) => (
                    <BriefEntryRow key={d.id} entry={d} />
                  ))}
                </ul>
              )}
            </div>
            <label className="text-xs font-medium text-muted-foreground">
              Completed milestones (read-only)
            </label>
            <div className="rounded-md border bg-muted/20 p-3 text-xs">
              {brief.completedMilestones.length === 0 ? (
                <span className="text-muted-foreground">No completed milestones yet.</span>
              ) : (
                <ul className="flex flex-col gap-2">
                  {brief.completedMilestones.map((m) => (
                    <BriefEntryRow key={m.id} entry={m} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            Save Brief (revision {revision})
          </Button>
          {successAt !== undefined && (
            <span className="text-xs text-muted-foreground">
              Saved at {new Date(successAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {conflict !== undefined && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
          >
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>{conflict}</span>
          </div>
        )}
        {error !== undefined && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BriefListEditor({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        disabled={disabled}
        placeholder={placeholder}
        className="font-mono text-xs"
      />
    </div>
  );
}

function BriefEntryRow({ entry }: { entry: BriefEntry }) {
  const icon: Record<BriefProvenance, LucideIcon> = {
    USER_APPROVED: CheckCircle2,
    SOURCE_VERIFIED: FileText,
    DRAFT: Clock,
  };
  const Icon = icon[entry.provenance];
  const label: Record<BriefProvenance, string> = {
    USER_APPROVED: "USER APPROVED",
    SOURCE_VERIFIED: "SOURCE-VERIFIED",
    DRAFT: "DRAFT",
  };
  const color: Record<BriefProvenance, string> = {
    USER_APPROVED: "text-emerald-600 dark:text-emerald-400",
    SOURCE_VERIFIED: "text-blue-600 dark:text-blue-400",
    DRAFT: "text-amber-600 dark:text-amber-400",
  };
  return (
    <li className="flex items-start gap-2">
      <Icon className={cn("size-3.5 shrink-0 mt-0.5", color[entry.provenance])} aria-hidden="true" />
      <div className="flex flex-col">
        <span className="break-words">{entry.text}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label[entry.provenance]}
          {entry.source !== undefined ? ` · ${entry.source}` : ""}
        </span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Relationships grid: conversations / missions / artifacts
// ---------------------------------------------------------------------------

function RelationshipsGrid({
  overview,
  onOpenConversation,
}: {
  overview: ProjectOverview;
  onOpenConversation: (conversationId: string) => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <ConversationsCard overview={overview} onOpen={onOpenConversation} />
      <MissionsCard overview={overview} />
      <ArtifactsCard overview={overview} />
    </div>
  );
}

function ConversationsCard({
  overview,
  onOpen,
}: {
  overview: ProjectOverview;
  onOpen: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessageSquare className="size-4" aria-hidden="true" />
          Conversations
          <span className="text-xs font-normal text-muted-foreground">
            ({overview.conversations.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        {overview.conversations.length === 0 ? (
          <span className="text-muted-foreground">
            No conversations linked to this project yet. Open the Home section
            to start a new conversation inside this project.
          </span>
        ) : (
          overview.conversations.map((c) => (
            <button
              key={c.conversationId}
              type="button"
              onClick={() => c.available && onOpen(c.conversationId)}
              disabled={!c.available}
              className={cn(
                "flex flex-col items-start gap-1 rounded-md border p-2 text-left transition-colors",
                c.available
                  ? "hover:bg-accent"
                  : "border-dashed border-destructive/30 opacity-60",
              )}
            >
              <span className="truncate font-medium">
                {c.available ? (c.title ?? "(untitled)") : "Unavailable conversation"}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {c.available
                  ? `${c.messageCount ?? 0} messages · updated ${c.updatedAt !== undefined ? new Date(c.updatedAt).toLocaleString() : "unknown"}`
                  : "Conversation no longer retrievable (gateway restarted or ownership changed)."}
              </span>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function MissionsCard({ overview }: { overview: ProjectOverview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="size-4" aria-hidden="true" />
          Missions
          <span className="text-xs font-normal text-muted-foreground">
            ({overview.missions.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        {overview.missions.length === 0 ? (
          <span className="text-muted-foreground">
            No missions linked. Authorize a mission from a project conversation to add it here.
          </span>
        ) : (
          overview.missions.map((m) => (
            <div
              key={m.missionId}
              className={cn(
                "flex items-start gap-2 rounded-md border p-2",
                m.availability === "unavailable" && "border-dashed border-amber-500/30",
              )}
            >
              {m.availability === "unavailable" ? (
                <Clock className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              ) : m.terminal ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
              )}
              <div className="flex flex-col">
                <span className="font-mono text-[10px]">{m.missionId.slice(0, 8)}…</span>
                <span className="text-[10px] text-muted-foreground">
                  {m.availability === "unavailable"
                    ? "Mission state UNAVAILABLE (gateway restarted)."
                    : `${m.status ?? "unknown"} · accepted ${m.acceptedAt !== undefined ? new Date(m.acceptedAt).toLocaleString() : "unknown"}`}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ArtifactsCard({ overview }: { overview: ProjectOverview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="size-4" aria-hidden="true" />
          Artifacts
          <span className="text-xs font-normal text-muted-foreground">
            ({overview.artifacts.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        {overview.artifacts.length === 0 ? (
          <span className="text-muted-foreground">
            No artifact references linked. Link verified artifacts from the mission workspace.
          </span>
        ) : (
          overview.artifacts.map((a, idx) => (
            <div
              key={`${a.missionId}:${a.path}:${idx}`}
              className={cn(
                "flex items-start gap-2 rounded-md border p-2",
                a.availability === "unavailable" && "border-dashed border-amber-500/30",
                a.availability === "missing" && "border-dashed border-destructive/30",
              )}
            >
              {a.availability === "available" ? (
                a.verified ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                ) : (
                  <XCircle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )
              ) : a.availability === "missing" ? (
                <XCircle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
              ) : (
                <Clock className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              )}
              <div className="flex flex-col">
                <span className="font-mono break-all">{a.path}</span>
                <span className="text-[10px] text-muted-foreground">
                  {a.availability === "available"
                    ? `${a.verified ? "verified" : "unverified"} · ${a.bytes ?? 0} bytes`
                    : a.availability === "missing"
                      ? "Artifact MISSING — the path is no longer in the mission's artifact list."
                      : "Artifact UNAVAILABLE — mission no longer in the in-process registry (gateway restarted)."}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Project metadata editor (name/description/status)
// ---------------------------------------------------------------------------

function ProjectMetadataEditor({
  project,
  onChanged,
}: {
  project: ProjectRecord;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState(project.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setStatus(project.status);
  }, [project]);

  const dirty = name !== project.name || description !== project.description || status !== project.status;

  const handleSave = async () => {
    setSaving(true);
    setError(undefined);
    const res = await genesisApi.updateProject(project.projectId, { name, description, status });
    if (res.kind === "ok") {
      await onChanged();
    } else {
      setError(res.message ?? "Failed to update project.");
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Project settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="project-name" className="text-xs font-medium text-muted-foreground">
            Name
          </label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            disabled={saving}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="project-description" className="text-xs font-medium text-muted-foreground">
            Description
          </label>
          <Textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            disabled={saving}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="project-status" className="text-xs font-medium text-muted-foreground">
            Status
          </label>
          <select
            id="project-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "active" | "archived")}
            disabled={saving}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="active">active</option>
            <option value="archived">archived</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            Save settings
          </Button>
        </div>
        {error !== undefined && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Silence the unused-import warning for ProjectListResult (kept for type
// re-export convenience to callers that want it).
void (undefined as unknown as ProjectListResult);
