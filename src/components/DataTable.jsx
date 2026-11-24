import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "./ui.jsx";

const PAGE_SIZE = 10;
const EMPTY = [];

export function DataTable({
  data,
  columns,
  searchPlaceholder = "Search...",
  searchKeys = EMPTY,
  filters = EMPTY,
  onRowClick,
}) {
  const [sorting, setSorting] = useState([]);
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState({});
  const [pageIndex, setPageIndex] = useState(0);

  const filteredData = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return data.filter((row) => {
      const matchesQuery =
        !normalizedQuery ||
        searchKeys.some((key) =>
          String(row[key] ?? "")
            .toLowerCase()
            .includes(normalizedQuery),
        );
      const matchesFilters = filters.every((filter) => {
        const selected = filterValues[filter.key];
        return !selected || String(row[filter.key] ?? "") === selected;
      });
      return matchesQuery && matchesFilters;
    });
  }, [data, filters, filterValues, query, searchKeys]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    // Pagination is owned here; table resets must not schedule redundant renders.
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const sortedRows = table.getRowModel().rows;
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(pageIndex, pageCount - 1);
  const pageRows = sortedRows.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );
  const firstRow = filteredData.length ? safePage * PAGE_SIZE + 1 : 0;
  const lastRow = Math.min(
    filteredData.length,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  function updateQuery(value) {
    setQuery(value);
    setPageIndex(0);
  }

  function updateFilter(key, value) {
    setFilterValues((current) => ({ ...current, [key]: value }));
    setPageIndex(0);
  }

  function sortLabel(direction) {
    if (direction === "asc") return " ASC";
    if (direction === "desc") return " DESC";
    return "";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col-reverse gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((filter) => (
            <select
              key={filter.key}
              value={filterValues[filter.key] || ""}
              onChange={(event) => updateFilter(filter.key, event.target.value)}
              className="select-control"
              aria-label={filter.label}
            >
              <option value="">{filter.label}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ))}
        </div>

        <div className="relative w-full xl:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mutedForeground"
            size={16}
          />
          <input
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm font-medium text-foreground outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-normal placeholder:text-mutedForeground hover:border-accent/50 focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
        <table className="min-w-[760px] w-full border-collapse text-sm">
          <thead className="bg-muted/60 text-left text-xs text-mutedForeground">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sortDirection = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <th key={header.id} className="px-4 py-3.5 font-medium">
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sortDirection ? (
                            <span className="text-[10px] text-accent">
                              {sortLabel(sortDirection)}
                            </span>
                          ) : null}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {pageRows.length ? (
              pageRows.map((row) => (
                <tr
                  key={row.id}
                  className="group border-t border-border/70 bg-card transition-colors duration-150 hover:bg-accentSoft/40 even:bg-muted/20"
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3.5 text-foreground">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  className="px-4 py-10 text-center text-sm text-mutedForeground"
                  colSpan={columns.length}
                >
                  No rows match the current search or filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 text-sm text-mutedForeground sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-xs">
          Showing {firstRow}-{lastRow} of {filteredData.length} results
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPageIndex(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
          >
            <ChevronLeft size={15} /> Previous
          </Button>
          <span className="rounded-md border border-border bg-card px-3 py-1 font-mono text-xs font-medium text-foreground">
            {safePage + 1} / {pageCount}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPageIndex(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage >= pageCount - 1}
          >
            Next <ChevronRight size={15} />
          </Button>
        </div>
      </div>
    </div>
  );
}
