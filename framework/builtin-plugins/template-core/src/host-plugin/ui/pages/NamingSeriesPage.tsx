/** Settings → Naming series page.
 *
 *  Per-resource document numbering pattern editor. Patterns support
 *  '.YYYY.', '.YY.', '.MM.', '.DD.', '.FY.', and runs of '#' (zero-
 *  padded counter). The default series for a resource is auto-applied
 *  on record create when the body doesn't supply a `name`.
 *
 *  Backend: admin-panel/backend/src/routes/naming-series.ts. */

import * as React from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Star,
  Search,
  Eye,
  AlertTriangle,
  Hash,
} from "lucide-react";

import { PageHeader } from "@/admin-primitives/PageHeader";
import { Card, CardContent } from "@/admin-primitives/Card";
import { EmptyState } from "@/admin-primitives/EmptyState";
import { Button } from "@/primitives/Button";
import { Input } from "@/primitives/Input";
import { Label } from "@/primitives/Label";
import { Badge } from "@/primitives/Badge";
import { Spinner } from "@/primitives/Spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/primitives/Dialog";
import {
  type NamingSeries,
  useNamingSeries,
  bumpNamingSeries,
  createNamingSeriesApi,
  updateNamingSeriesApi,
  deleteNamingSeriesApi,
  previewNamingSeries,
} from "@/runtime/useCustomizationApi";
import { cn } from "@/lib/cn";

interface ResourceDescriptor {
  id: string;
  label: string;
  category: string;
}

const RESOURCES: readonly ResourceDescriptor[] = [
  { id: "sales.quote", label: "Quotations", category: "Sales" },
  { id: "sales.order", label: "Sales orders", category: "Sales" },
  { id: "sales.deal", label: "Deals", category: "Sales" },
  { id: "accounting.invoice", label: "Invoices", category: "Accounting" },
  { id: "accounting.bill", label: "Bills", category: "Accounting" },
  { id: "accounting.payment", label: "Payments", category: "Accounting" },
  { id: "accounting.journal", label: "Journal entries", category: "Accounting" },
  { id: "procurement.po", label: "Purchase orders", category: "Procurement" },
  { id: "procurement.req", label: "Requisitions", category: "Procurement" },
  { id: "inventory.delivery", label: "Delivery notes", category: "Inventory" },
  { id: "inventory.receipt", label: "Receipts", category: "Inventory" },
  { id: "inventory.transfer", label: "Stock transfers", category: "Inventory" },
  { id: "manufacturing.bom", label: "BOMs", category: "Manufacturing" },
  { id: "manufacturing.work_order", label: "Work orders", category: "Manufacturing" },
  { id: "ops.ticket", label: "Tickets", category: "Operations" },
  { id: "ops.project", label: "Projects", category: "Operations" },
  { id: "hr.employee", label: "Employees", category: "People" },
];

function ResourceRail({
  active,
  onPick,
}: {
  active: string;
  onPick: (id: string) => void;
}) {
  const [search, setSearch] = React.useState("");
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return RESOURCES;
    return RESOURCES.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  }, [search]);
  const byCat = new Map<string, ResourceDescriptor[]>();
  for (const r of filtered) {
    const list = byCat.get(r.category) ?? [];
    list.push(r);
    byCat.set(r.category, list);
  }
  return (
    <aside className="flex flex-col gap-2 min-h-0">
      <Input
        prefix={<Search className="h-3.5 w-3.5" />}
        placeholder="Search resources…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8"
      />
      <div className="flex flex-col gap-0.5 overflow-y-auto -mr-2 pr-2 min-h-0">
        {[...byCat.entries()].map(([cat, list]) => (
          <div key={cat} className="flex flex-col gap-0.5">
            <div className="text-[11px] uppercase tracking-wider text-text-muted px-2 pt-2 mb-0.5">
              {cat}
            </div>
            {list.map((r) => {
              const isActive = r.id === active;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onPick(r.id)}
                  className={cn(
                    "flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors min-w-0",
                    isActive
                      ? "bg-accent-subtle text-accent font-medium"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-2",
                  )}
                >
                  <span className="min-w-0 truncate">{r.label}</span>
                  <code className={cn("font-mono text-[10px] truncate shrink-0", isActive ? "text-accent/70" : "text-text-muted")}>
                    {r.id}
                  </code>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

function PatternHelp() {
  const tokens: ReadonlyArray<{ token: string; meaning: string }> = [
    { token: ".YYYY.", meaning: "Four-digit year (2026)" },
    { token: ".YY.", meaning: "Two-digit year (26)" },
    { token: ".MM.", meaning: "Month (01–12)" },
    { token: ".DD.", meaning: "Day (01–31)" },
    { token: ".FY.", meaning: "Fiscal year (defaults to calendar)" },
    { token: "#####", meaning: "Counter, padded to width (5 here)" },
  ];
  return (
    <div className="rounded-md border border-border-subtle bg-surface-1/40 p-3 flex flex-col gap-1.5">
      <div className="text-xs font-medium text-text-muted uppercase tracking-wider">
        Pattern tokens
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {tokens.map((t) => (
          <div key={t.token} className="flex items-baseline gap-2 min-w-0">
            <code className="font-mono text-[11px] text-accent shrink-0">{t.token}</code>
            <span className="text-text-secondary truncate">{t.meaning}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DialogProps {
  resource: string;
  initial: NamingSeries | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}

function SeriesDialog({ resource, initial, open, onOpenChange, onSaved }: DialogProps) {
  const [pattern, setPattern] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [isDefault, setIsDefault] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [previewSamples, setPreviewSamples] = React.useState<string[]>([]);
  const [previewBucket, setPreviewBucket] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    if (initial) {
      setPattern(initial.pattern);
      setLabel(initial.label ?? "");
      setIsDefault(initial.isDefault);
    } else {
      setPattern("");
      setLabel("");
      setIsDefault(false);
    }
    setApiError(null);
    setPreviewSamples([]);
    setPreviewBucket("");
  }, [open, initial]);

  React.useEffect(() => {
    if (!pattern.trim()) {
      setPreviewSamples([]);
      setPreviewBucket("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewNamingSeries(resource, pattern)
        .then((p) => {
          if (cancelled) return;
          setPreviewSamples(p.samples);
          setPreviewBucket(p.bucket);
        })
        .catch(() => {
          if (cancelled) return;
          setPreviewSamples([]);
          setPreviewBucket("");
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resource, pattern]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setApiError(null);
    try {
      if (initial) {
        await updateNamingSeriesApi(resource, initial.id, {
          label: label.trim() || null,
          isDefault,
        });
      } else {
        await createNamingSeriesApi(resource, {
          pattern: pattern.trim(),
          label: label.trim() || undefined,
          isDefault,
        });
      }
      bumpNamingSeries(resource);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit naming series" : "New naming series"}</DialogTitle>
          <DialogDescription>
            {initial
              ? <>Change label or default flag. Patterns are immutable to keep counters consistent.</>
              : <>Add a numbering pattern for <code className="font-mono">{resource}</code>.</>}
          </DialogDescription>
        </DialogHeader>

        {apiError ? (
          <div className="rounded-md border border-intent-danger/40 bg-intent-danger-bg/30 px-3 py-2 text-sm text-intent-danger flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="flex-1">{apiError}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ns-pattern" required>Pattern</Label>
            <Input
              id="ns-pattern"
              placeholder="INV-.YYYY.-.#####"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              disabled={!!initial}
              className="font-mono"
            />
            <span className="text-xs text-text-muted">
              Patterns are unique per resource and immutable after creation.
            </span>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <PatternHelp />
          </div>

          {previewSamples.length > 0 ? (
            <div className="rounded-md border border-border-subtle bg-surface-1/40 p-3 flex flex-col gap-2 sm:col-span-2">
              <div className="text-xs font-medium text-text-muted uppercase tracking-wider flex items-center gap-2">
                <Eye className="h-3 w-3" />
                Preview
                {previewBucket ? (
                  <span className="font-normal lowercase tracking-normal text-text-muted">
                    bucket: <code className="font-mono text-[11px]">{previewBucket}</code>
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {previewSamples.map((s) => (
                  <code key={s} className="px-2 py-0.5 rounded bg-surface-2 text-text-primary font-mono text-xs">
                    {s}
                  </code>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ns-label">Label (optional)</Label>
            <Input
              id="ns-label"
              placeholder="Annual invoice series"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-1 px-3 py-2 sm:col-span-2">
            <div className="flex flex-col">
              <Label htmlFor="ns-default" className="cursor-pointer">Default for this resource</Label>
              <span className="text-xs text-text-muted">
                Auto-applied when records are created without a name.
              </span>
            </div>
            <input
              id="ns-default"
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 cursor-pointer"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={submitting || (!initial && !pattern.trim())}
            loading={submitting}
          >
            {initial ? "Save" : "Add series"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NamingSeriesPage() {
  const [active, setActive] = React.useState<string>(RESOURCES[0]!.id);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<NamingSeries | null>(null);
  const [busyDelete, setBusyDelete] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { rows, loading, refresh } = useNamingSeries(active);

  const handleDelete = async (s: NamingSeries) => {
    if (busyDelete) return;
    if (!confirm(`Delete series "${s.pattern}"? Counters for this series will reset if you re-create.`)) return;
    setBusyDelete(s.id);
    try {
      await deleteNamingSeriesApi(active, s.id);
      bumpNamingSeries(active);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyDelete(null);
    }
  };

  const handleMakeDefault = async (s: NamingSeries) => {
    try {
      await updateNamingSeriesApi(active, s.id, { isDefault: true });
      bumpNamingSeries(active);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <PageHeader
        title="Naming series"
        description="Document numbering patterns per resource. Counters are atomic and bucket-aware (resets per year/month based on tokens used)."
        actions={
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            New series
          </Button>
        }
      />

      {error ? (
        <div className="rounded-md border border-intent-danger/40 bg-intent-danger-bg/30 px-3 py-2 text-sm text-intent-danger flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button className="text-xs underline opacity-80 hover:opacity-100" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[260px_1fr] min-h-0">
        <ResourceRail active={active} onPick={setActive} />
        <main className="flex flex-col gap-3 min-w-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="flex items-baseline gap-2 min-w-0">
              <h2 className="text-base font-semibold text-text-primary truncate">
                {RESOURCES.find((r) => r.id === active)?.label ?? active}
              </h2>
              <code className="text-xs font-mono text-text-muted truncate">{active}</code>
            </div>
            {rows.length > 0 ? (
              <span className="text-xs text-text-muted">
                {rows.length} {rows.length === 1 ? "series" : "series"}
              </span>
            ) : null}
          </div>

          {loading ? (
            <Card>
              <CardContent className="py-12 flex items-center justify-center text-sm text-text-muted">
                <Spinner size={14} />
                <span className="ml-2">Loading…</span>
              </CardContent>
            </Card>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<Hash className="h-5 w-5" />}
                  title="No naming series yet"
                  description="Add a pattern like 'INV-.YYYY.-.#####' to auto-number new records on this resource."
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      iconLeft={<Plus className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setEditing(null);
                        setDialogOpen(true);
                      }}
                    >
                      Add series
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-1 border-b border-border text-xs uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium">Pattern</th>
                      <th className="text-left py-2 font-medium">Label</th>
                      <th className="text-left py-2 font-medium w-24">Default</th>
                      <th className="text-right py-2 pr-3 font-medium w-44">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr
                        key={s.id}
                        className="border-b border-border-subtle last:border-b-0 hover:bg-surface-1 transition-colors"
                      >
                        <td className="py-2 px-3 align-middle">
                          <code className="font-mono text-xs text-text-primary">{s.pattern}</code>
                        </td>
                        <td className="py-2 align-middle">
                          {s.label ? (
                            <span className="text-text-primary">{s.label}</span>
                          ) : (
                            <span className="text-text-muted text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2 align-middle">
                          {s.isDefault ? (
                            <Badge intent="success" className="font-normal">
                              <Star className="h-3 w-3 mr-1" /> Default
                            </Badge>
                          ) : (
                            <Button size="xs" variant="ghost" onClick={() => handleMakeDefault(s)}>
                              Make default
                            </Button>
                          )}
                        </td>
                        <td className="py-2 pr-3 align-middle">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                setEditing(s);
                                setDialogOpen(true);
                              }}
                              iconLeft={<Pencil className="h-3 w-3" />}
                            >
                              Edit
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => handleDelete(s)}
                              iconLeft={<Trash2 className="h-3 w-3" />}
                              loading={busyDelete === s.id}
                              className="text-intent-danger hover:bg-intent-danger-bg/30"
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </main>
      </div>

      <SeriesDialog
        resource={active}
        initial={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => void refresh()}
      />
    </div>
  );
}
