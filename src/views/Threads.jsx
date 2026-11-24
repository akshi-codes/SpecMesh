import { useMemo, useState } from "react";
import { Bookmark } from "lucide-react";
import { DataTable } from "../components/DataTable.jsx";
import { Card, CardHeader, Button } from "../components/ui.jsx";
import { formatCompact } from "../lib/api.js";
export function Threads({ threads, onOpenThread, onSaveAnnotation }) {
  const [bookmarks, setBookmarks] = useState(false);
  const data = threads
    .filter((t) => !bookmarks || t.bookmarked)
    .map((t) => ({ ...t, tagText: t.tags.join(" ") }));
  const columns = useMemo(
    () => [
      {
        header: "Thread",
        accessorKey: "title",
        cell: ({ row }) => (
          <button
            className="text-left font-semibold hover:underline"
            onClick={() => onOpenThread(row.original.id)}
          >
            {row.original.title}
            <span className="mt-1 block font-mono text-[10px] font-normal text-mutedForeground">
              {row.original.id.slice(0, 16)}
            </span>
          </button>
        ),
      },
      { header: "Project", accessorKey: "project_name" },
      {
        header: "Tokens",
        accessorKey: "tokens",
        cell: ({ getValue }) => formatCompact(getValue()),
      },
      { header: "Events", accessorKey: "turns" },
      {
        header: "Models",
        accessorKey: "model",
        cell: ({ row }) => row.original.models.join(", "),
      },
      { header: "Tags", accessorKey: "tagText" },
      {
        header: "Saved",
        id: "bookmark",
        cell: ({ row }) => (
          <Button
            size="icon"
            variant="ghost"
            aria-label={
              row.original.bookmarked ? "Remove bookmark" : "Bookmark thread"
            }
            aria-pressed={row.original.bookmarked}
            onClick={() =>
              onSaveAnnotation("thread", row.original.id, {
                bookmarked: !row.original.bookmarked,
              }).catch(() => {})
            }
          >
            <Bookmark
              size={16}
              fill={row.original.bookmarked ? "currentColor" : "none"}
            />
          </Button>
        ),
      },
    ],
    [onOpenThread, onSaveAnnotation],
  );
  return (
    <Card>
      <CardHeader
        title="Thread library"
        description="Search the complete history in this reporting window. Open a thread to inspect its usage events."
        action={
          <Button
            variant={bookmarks ? "primary" : "secondary"}
            size="sm"
            onClick={() => setBookmarks(!bookmarks)}
          >
            <Bookmark size={14} />
            {bookmarks ? "Bookmarks only" : "All threads"}
          </Button>
        }
      />
      <div className="p-4">
        <DataTable
          data={data}
          columns={columns}
          searchKeys={["title", "id", "project_name", "model", "tagText"]}
          searchPlaceholder="Search titles, projects, models, or tags…"
        />
      </div>
    </Card>
  );
}
