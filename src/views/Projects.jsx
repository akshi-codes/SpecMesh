import { useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Card, CardHeader, Button } from "../components/ui.jsx";
import { DataTable } from "../components/DataTable.jsx";
import { Sheet, Field } from "../components/Interactions.jsx";
import { formatCompact } from "../lib/api.js";
export function Projects({
  projects,
  annotations,
  onOpenProject,
  onSaveAnnotation,
  onFilter,
}) {
  const [edit, setEdit] = useState(null),
    [label, setLabel] = useState(""),
    [group, setGroup] = useState(""),
    [saving, setSaving] = useState(false);
  function open(p) {
    const a = annotations.find((a) => a.kind === "project" && a.id === p.id);
    setEdit(p);
    setLabel(a?.label || "");
    setGroup(a?.group_name || "");
  }
  const columns = useMemo(
    () => [
      {
        header: "Project",
        accessorKey: "name",
        cell: ({ row }) => (
          <button
            className="text-left font-semibold hover:underline"
            onClick={() => onOpenProject(row.original.id)}
          >
            {row.original.name}
            <span
              className="mt-1 block max-w-64 truncate text-xs font-normal text-mutedForeground"
              title={row.original.path}
            >
              {row.original.path}
            </span>
          </button>
        ),
      },
      { header: "Group", accessorKey: "group_name" },
      {
        header: "Tokens",
        accessorKey: "tokens",
        cell: ({ getValue }) => formatCompact(getValue()),
      },
      { header: "Threads", accessorKey: "threads" },
      { header: "Events", accessorKey: "turns" },
      {
        header: "Organize",
        id: "edit",
        cell: ({ row }) => (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => open(row.original)}
          >
            Edit alias / group
          </Button>
        ),
      },
    ],
    [onOpenProject, annotations],
  );
  const groups = [
    ...new Set(projects.map((p) => p.group_name).filter(Boolean)),
  ];
  return (
    <>
      <Card>
        <CardHeader
          title="Your workspaces"
          description="Aliases and groups organize folders without changing their source paths."
        />
        <div className="space-y-4 p-4">
          {groups.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <button
                  key={g}
                  className="filter-chip"
                  onClick={() => onFilter({ group: g })}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
          <DataTable
            data={projects}
            columns={columns}
            searchKeys={["name", "path", "group_name"]}
            searchPlaceholder="Search projects, folders, or groups…"
          />
        </div>
      </Card>
      <AnimatePresence>
        {edit && (
          <Sheet title="Organize project" onClose={() => setEdit(null)}>
            <p className="break-all text-sm text-mutedForeground">
              {edit.path}
            </p>
            <form
              className="space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                try {
                  await onSaveAnnotation("project", edit.id, {
                    label,
                    group_name: group,
                  });
                  setEdit(null);
                } catch {
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Field
                label="Project alias"
                hint="Leave empty to use the original folder name."
              >
                <input
                  maxLength={120}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
              <Field
                label="Group"
                hint="Give related folders the same group name. Clear it to undo grouping."
              >
                <input
                  maxLength={80}
                  list="project-groups"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                />
                <datalist id="project-groups">
                  {groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </Field>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save organization"}
              </Button>
            </form>
          </Sheet>
        )}
      </AnimatePresence>
    </>
  );
}
