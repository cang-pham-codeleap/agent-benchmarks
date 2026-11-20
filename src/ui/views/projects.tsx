import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge, ToolBadge, toolLabel } from "../badges.tsx";
import { CostValue, EmptyState, StatCard } from "../common.tsx";
import { relativeTime } from "../date-time.ts";
import { basename, capitalize, formatInt } from "../format.ts";
import { Link } from "../link.tsx";
import { projectSessionsHref } from "../navigation.ts";
import { SyncButton } from "../sync-button.tsx";
import type { ProjectSummary } from "../types.ts";

export function ProjectsView({
  onSync,
  projects,
  syncing,
}: {
  onSync: () => void;
  projects: ProjectSummary[];
  syncing: boolean;
}) {
  const [query, setQuery] = useState("");
  const sorted = useMemo(
    () =>
      projects
        .slice()
        .sort(
          (left, right) =>
            Number(left.is_worktree) - Number(right.is_worktree) ||
            right.sessions - left.sessions ||
            right.estimated_cost_usd - left.estimated_cost_usd ||
            left.path.localeCompare(right.path),
        ),
    [projects],
  );
  const shown = useMemo(() => filterProjects(sorted, query), [sorted, query]);
  const filtering = query.trim() !== "";
  const worktrees = projects.filter((project) => project.is_worktree);
  const activitySources = new Set(projects.flatMap((project) => project.session_tools));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">Project roots, worktrees, source tools, and local session activity.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="folder"
          label="Projects"
          value={formatInt(projects.filter((project) => !project.is_worktree).length)}
        />
        <StatCard icon="folder" label="Worktrees" value={formatInt(worktrees.length)} />
        <StatCard icon="tools" label="Activity sources" value={formatInt(activitySources.size)} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Projects and worktrees</CardTitle>
            <p className="text-sm text-muted-foreground">
              Worktree source comes from Git pointers, known layouts, or root name matching. {" "}
              <span role="status">
                {filtering
                  ? `Showing ${formatInt(shown.length)} of ${formatInt(sorted.length)}.`
                  : ""}
              </span>
            </p>
          </div>
          {sorted.length > 0 ? (
            <div className="w-full sm:w-72">
              <Input
                aria-label="Filter projects"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by name, path, or tool..."
                value={query}
              />
            </div>
          ) : null}
        </CardHeader>
        {sorted.length === 0 ? (
          <EmptyState
            action={
              <SyncButton
                ariaLabel="Sync session logs"
                busy={syncing}
                label="Sync now"
                onClick={onSync}
                tone="primary"
              />
            }
            icon="folder"
            message="Projects appear after sessions are synced."
            title="No projects"
          />
        ) : shown.length === 0 ? (
          <EmptyState
            action={
              <Button variant="outline" onClick={() => setQuery("")} type="button">
                Clear filter
              </Button>
            }
            icon="folder"
            message={`No project or worktree matches "${query.trim()}".`}
            title="No matching projects"
          />
        ) : (
          <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Root</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="max-w-xs truncate" title={project.path}>
                      <Link className="flex flex-col gap-1 hover:underline" href={projectSessionsHref(project.path)}>
                        <strong>{projectName(project)}</strong>
                        <small className="truncate text-xs text-muted-foreground">{project.path}</small>
                      </Link>
                    </TableCell>
                    <TableCell><ProjectKind project={project} /></TableCell>
                    <TableCell><ProjectSource project={project} /></TableCell>
                    <TableCell className="max-w-xs truncate" title={project.root_path ?? project.path}>
                      {project.is_worktree ? (
                        <span className="flex flex-col gap-1">
                          <strong>{basename(project.root_path)}</strong>
                          <small className="truncate text-xs text-muted-foreground">{project.root_path ?? "-"}</small>
                        </span>
                      ) : project.worktree_count > 0 ? (
                        <span className="text-sm text-muted-foreground">
                          {formatInt(project.worktree_count)}{" "}
                          {project.worktree_count === 1 ? "worktree" : "worktrees"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatInt(project.sessions)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <CostValue
                        cost={project.estimated_cost_usd}
                        dense
                        sessions={project.sessions}
                        usageSessions={project.usage_sessions}
                      />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{relativeTime(project.last_seen_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

export function filterProjects(projects: ProjectSummary[], query: string): ProjectSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return projects;
  }
  return projects.filter((project) => {
    const text = [
      projectName(project),
      project.path,
      project.root_path,
      project.is_worktree ? "worktree" : "project",
      project.is_worktree ? worktreeToolLabel(project.worktree_tool) : null,
      ...project.session_tools,
      ...project.session_tools.map(toolLabel),
    ]
      .filter((value): value is string => value != null)
      .join("\n")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export function ProjectKind({ project }: { project: ProjectSummary }) {
  if (project.is_worktree) {
    return <Badge tone="info">worktree</Badge>;
  }
  return <Badge tone="neutral">project</Badge>;
}

export function ProjectSource({ project }: { project: ProjectSummary }) {
  if (project.is_worktree) {
    return (
      <span className="flex flex-col items-start gap-1">
        <Badge tone="accent">{worktreeToolLabel(project.worktree_tool)}</Badge>
        <small className="text-xs text-muted-foreground">{rootSourceLabel(project.root_source)}</small>
      </span>
    );
  }
  if (project.session_tools.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {project.session_tools.map((tool) => (
        <ToolBadge key={tool} tool={tool} />
      ))}
    </span>
  );
}

export function projectName(project: ProjectSummary): string {
  if (!project.is_worktree) {
    return project.name ?? basename(project.path);
  }
  const label = project.worktree_label ?? basename(project.path);
  return label === "wt" ? "worktree" : label;
}

export function worktreeToolLabel(value: string | null): string {
  switch (value) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "conductor":
      return "Conductor";
    case "git":
      return "Git";
    case "t3":
      return "T3";
    case "warp":
      return "Warp";
    case null:
      return "Worktree";
    default:
      return capitalize(value);
  }
}

export function rootSourceLabel(value: string | null): string {
  switch (value) {
    case "git":
      return "Git worktree pointer";
    case "intree":
      return "In-project worktrees folder";
    case "namematch":
      return "Matched to project root";
    case "self":
      return "Project root";
    case "synthetic":
      return "Inferred root";
    case null:
      return "Unknown source";
    default:
      return capitalize(value);
  }
}
