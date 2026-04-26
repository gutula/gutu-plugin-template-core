/** Settings → Print formats page.
 *
 *  Per-resource HTML/Jinja-like template editor with live preview. The
 *  same template engine powers notification rules. Resources show in a
 *  rail; selecting one lists its formats and lets you create / edit /
 *  preview / set default.
 *
 *  Backend: admin-panel/backend/src/routes/print-formats.ts. */

import * as React from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Star,
  Search,
  AlertTriangle,
  FileText,
  Eye,
  Printer,
} from "lucide-react";

import { PageHeader } from "@/admin-primitives/PageHeader";
import { Card, CardContent } from "@/admin-primitives/Card";
import { EmptyState } from "@/admin-primitives/EmptyState";
import { Button } from "@/primitives/Button";
import { Input } from "@/primitives/Input";
import { Label } from "@/primitives/Label";
import { Badge } from "@/primitives/Badge";
import { Spinner } from "@/primitives/Spinner";
import { Textarea } from "@/primitives/Textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/primitives/Dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/primitives/Select";
import {
  type PrintFormat,
  usePrintFormats,
  bumpPrintFormats,
  createPrintFormatApi,
  updatePrintFormatApi,
  deletePrintFormatApi,
  renderPrintFormatApi,
  useLetterHeads,
} from "@/runtime/useCustomizationApi";
import { cn } from "@/lib/cn";

const RESOURCES: ReadonlyArray<{ id: string; label: string; category: string }> = [
  { id: "sales.quote", label: "Quotations", category: "Sales" },
  { id: "sales.order", label: "Sales orders", category: "Sales" },
  { id: "accounting.invoice", label: "Invoices", category: "Accounting" },
  { id: "accounting.bill", label: "Bills", category: "Accounting" },
  { id: "accounting.payment", label: "Payments", category: "Accounting" },
  { id: "procurement.po", label: "Purchase orders", category: "Procurement" },
  { id: "inventory.delivery", label: "Delivery notes", category: "Inventory" },
  { id: "inventory.receipt", label: "Receipts", category: "Inventory" },
  { id: "manufacturing.work_order", label: "Work orders", category: "Manufacturing" },
  { id: "hr.employee", label: "Employees", category: "People" },
];

const SAMPLE_TEMPLATE = `<h1>Invoice {{ name | default("(unsaved)") }}</h1>
<p><strong>Customer:</strong> {{ customer_name }}</p>
<p><strong>Date:</strong> {{ posting_date | date }}</p>

<table>
  <thead>
    <tr><th>Item</th><th>Qty</th><th class="pf-amount">Rate</th><th class="pf-amount">Amount</th></tr>
  </thead>
  <tbody>
    {% for line in items %}
    <tr>
      <td>{{ line.item_name }}</td>
      <td>{{ line.qty }}</td>
      <td class="pf-amount">{{ line.rate | currency }}</td>
      <td class="pf-amount">{{ line.amount | currency }}</td>
    </tr>
    {% endfor %}
  </tbody>
</table>

<p style="text-align: right; font-weight: bold;">
  Total: {{ grand_total | currency }}
</p>

{% if terms %}
<h3>Terms</h3>
<p>{{ terms }}</p>
{% endif %}`;

const SAMPLE_RECORD = {
  name: "INV-2026-00042",
  customer_name: "Acme Corp",
  posting_date: "2026-04-26T00:00:00.000Z",
  items: [
    { item_name: "Widget A", qty: 2, rate: 50, amount: 100 },
    { item_name: "Widget B", qty: 5, rate: 20, amount: 100 },
  ],
  grand_total: 200,
  terms: "Net 30 days. Late fee 1.5% per month.",
};

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
  const byCat = new Map<string, typeof RESOURCES>();
  for (const r of filtered) {
    const list = (byCat.get(r.category) ?? []) as typeof RESOURCES;
    byCat.set(r.category, [...list, r] as typeof RESOURCES);
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

interface DialogProps {
  resource: string;
  initial: PrintFormat | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}

function PrintFormatDialog({ resource, initial, open, onOpenChange, onSaved }: DialogProps) {
  const [name, setName] = React.useState("");
  const [template, setTemplate] = React.useState(SAMPLE_TEMPLATE);
  const [paperSize, setPaperSize] = React.useState("A4");
  const [orientation, setOrientation] = React.useState<"portrait" | "landscape">("portrait");
  const [letterheadId, setLetterheadId] = React.useState<string>("none");
  const [isDefault, setIsDefault] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = React.useState<string>("");
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewErrors, setPreviewErrors] = React.useState<Array<{ message: string; near: string }>>([]);
  const [previewRecordRaw, setPreviewRecordRaw] = React.useState<string>(
    JSON.stringify(SAMPLE_RECORD, null, 2),
  );
  const { rows: letterHeads } = useLetterHeads();

  React.useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setTemplate(initial.template);
      setPaperSize(initial.paperSize);
      setOrientation(initial.orientation);
      setLetterheadId(initial.letterheadId ?? "none");
      setIsDefault(initial.isDefault);
    } else {
      setName("");
      setTemplate(SAMPLE_TEMPLATE);
      setPaperSize("A4");
      setOrientation("portrait");
      setLetterheadId("none");
      setIsDefault(false);
    }
    setApiError(null);
    setPreviewHtml("");
    setPreviewErrors([]);
  }, [open, initial]);

  const renderPreview = async () => {
    if (!initial) {
      // Render via temporary save would mutate the DB; instead, render
      // the template inline against the sample record by calling the
      // *existing* server route on a saved format. New formats need to
      // be saved at least once before live preview is available.
      setPreviewHtml(`<p style="font-family:system-ui;color:#6b7280;padding:24px;">
        Save the format once to enable server-side render preview. The
        editor below shows the raw template.
      </p>`);
      return;
    }
    setPreviewLoading(true);
    try {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(previewRecordRaw);
      } catch {
        record = SAMPLE_RECORD as Record<string, unknown>;
      }
      const out = await renderPrintFormatApi(resource, initial.id, { record });
      setPreviewHtml(out.html);
      setPreviewErrors(out.errors);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  React.useEffect(() => {
    if (!open || !initial) return;
    void renderPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, template]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setApiError(null);
    try {
      const lhId = letterheadId === "none" ? null : letterheadId;
      if (initial) {
        await updatePrintFormatApi(resource, initial.id, {
          name,
          template,
          paperSize,
          orientation,
          letterheadId: lhId,
          isDefault,
        });
      } else {
        await createPrintFormatApi(resource, {
          name,
          template,
          paperSize,
          orientation,
          letterheadId: lhId,
          isDefault,
        });
      }
      bumpPrintFormats(resource);
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
      <DialogContent size="xl" className="max-w-6xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit print format" : "New print format"}</DialogTitle>
          <DialogDescription>
            HTML + template tokens (<code className="font-mono">{"{{ field }}"}</code>,{" "}
            <code className="font-mono">{"{% if … %}"}</code>,{" "}
            <code className="font-mono">{"{% for … %}"}</code>) rendered server-side.
          </DialogDescription>
        </DialogHeader>

        {apiError ? (
          <div className="rounded-md border border-intent-danger/40 bg-intent-danger-bg/30 px-3 py-2 text-sm text-intent-danger flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="flex-1">{apiError}</span>
          </div>
        ) : null}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="pf-name" required>Name</Label>
            <Input
              id="pf-name"
              placeholder="Standard Invoice"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Paper size</Label>
            <Select value={paperSize} onValueChange={setPaperSize}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A4">A4</SelectItem>
                <SelectItem value="Letter">Letter</SelectItem>
                <SelectItem value="A5">A5</SelectItem>
                <SelectItem value="Legal">Legal</SelectItem>
                <SelectItem value="Thermal">Thermal (POS)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Orientation</Label>
            <Select value={orientation} onValueChange={(v) => setOrientation(v as never)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="portrait">Portrait</SelectItem>
                <SelectItem value="landscape">Landscape</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>Letter head</Label>
            <Select value={letterheadId} onValueChange={setLetterheadId}>
              <SelectTrigger>
                <SelectValue placeholder="(none)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">(none)</SelectItem>
                {letterHeads.map((lh) => (
                  <SelectItem key={lh.id} value={lh.id}>
                    {lh.name} {lh.isDefault ? "(default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-1 px-3 py-2 sm:col-span-2">
            <div className="flex flex-col">
              <Label htmlFor="pf-default" className="cursor-pointer">Default for this resource</Label>
              <span className="text-xs text-text-muted">Auto-selected on Print actions.</span>
            </div>
            <input
              id="pf-default"
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 cursor-pointer"
            />
          </div>
        </div>

        <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 flex-1 min-h-0">
          <div className="flex flex-col gap-1.5 min-h-0">
            <Label htmlFor="pf-template">Template</Label>
            <Textarea
              id="pf-template"
              rows={20}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="font-mono text-xs flex-1"
            />
            <details className="text-xs text-text-muted">
              <summary className="cursor-pointer">Preview record (JSON)</summary>
              <Textarea
                rows={8}
                value={previewRecordRaw}
                onChange={(e) => setPreviewRecordRaw(e.target.value)}
                className="font-mono text-xs mt-1"
              />
            </details>
            {previewErrors.length > 0 ? (
              <div className="rounded-md border border-intent-warning/40 bg-intent-warning-bg/20 p-2 text-xs">
                <div className="font-medium text-intent-warning mb-1">Render warnings</div>
                {previewErrors.map((e, i) => (
                  <div key={i} className="flex items-baseline gap-2">
                    <code className="font-mono shrink-0 text-text-muted">{e.near}</code>
                    <span>{e.message}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5 min-h-0">
            <div className="flex items-center justify-between">
              <Label>Preview</Label>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void renderPreview()}
                disabled={previewLoading}
                iconLeft={<Eye className="h-3 w-3" />}
              >
                {previewLoading ? "Rendering…" : "Refresh"}
              </Button>
            </div>
            <div className="border border-border rounded-md bg-white text-black overflow-auto flex-1 min-h-[300px]">
              {previewHtml ? (
                <iframe
                  title="Print preview"
                  srcDoc={previewHtml}
                  sandbox="allow-same-origin"
                  className="w-full h-full min-h-[300px]"
                  style={{ border: 0 }}
                />
              ) : (
                <div className="p-4 text-xs text-gray-500">
                  Save once to enable live preview. The format will render against the JSON
                  payload to the left.
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={submitting || !name.trim() || !template.trim()}
            loading={submitting}
          >
            {initial ? "Save changes" : "Create format"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PrintFormatsPage() {
  const [active, setActive] = React.useState<string>(RESOURCES[0]!.id);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PrintFormat | null>(null);
  const [busyDelete, setBusyDelete] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { rows, loading, refresh } = usePrintFormats(active);

  const handleDelete = async (f: PrintFormat) => {
    if (!confirm(`Delete print format "${f.name}"?`)) return;
    setBusyDelete(f.id);
    try {
      await deletePrintFormatApi(active, f.id);
      bumpPrintFormats(active);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyDelete(null);
    }
  };

  const handleMakeDefault = async (f: PrintFormat) => {
    try {
      await updatePrintFormatApi(active, f.id, { isDefault: true });
      bumpPrintFormats(active);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <PageHeader
        title="Print formats"
        description="HTML templates rendered server-side, printable via the browser. Same engine drives notification rule templates."
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
            New format
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
            <h2 className="text-base font-semibold text-text-primary truncate">
              {RESOURCES.find((r) => r.id === active)?.label ?? active}
            </h2>
            {rows.length > 0 ? (
              <span className="text-xs text-text-muted">{rows.length} formats</span>
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
                  icon={<FileText className="h-5 w-5" />}
                  title="No print formats yet"
                  description="Create the first template — typical examples include 'Standard Invoice', 'Thermal Receipt', 'Packing Slip'."
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
                      New format
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
                      <th className="text-left py-2 px-3 font-medium">Name</th>
                      <th className="text-left py-2 font-medium">Paper</th>
                      <th className="text-left py-2 font-medium">Letter head</th>
                      <th className="text-left py-2 font-medium w-24">Default</th>
                      <th className="text-right py-2 pr-3 font-medium w-44">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => (
                      <tr
                        key={f.id}
                        className="border-b border-border-subtle last:border-b-0 hover:bg-surface-1 transition-colors"
                      >
                        <td className="py-2 px-3 align-middle">
                          <div className="flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 text-text-muted shrink-0" />
                            <span className="text-text-primary">{f.name}</span>
                          </div>
                        </td>
                        <td className="py-2 align-middle">
                          <Badge intent="neutral" className="font-normal">
                            {f.paperSize} {f.orientation === "landscape" ? "↔" : "↕"}
                          </Badge>
                        </td>
                        <td className="py-2 align-middle">
                          {f.letterheadId ? (
                            <Badge intent="info" className="font-normal">linked</Badge>
                          ) : (
                            <span className="text-text-muted text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2 align-middle">
                          {f.isDefault ? (
                            <Badge intent="success" className="font-normal">
                              <Star className="h-3 w-3 mr-1" /> Default
                            </Badge>
                          ) : (
                            <Button size="xs" variant="ghost" onClick={() => handleMakeDefault(f)}>
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
                                setEditing(f);
                                setDialogOpen(true);
                              }}
                              iconLeft={<Pencil className="h-3 w-3" />}
                            >
                              Edit
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => handleDelete(f)}
                              iconLeft={<Trash2 className="h-3 w-3" />}
                              loading={busyDelete === f.id}
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

      <PrintFormatDialog
        resource={active}
        initial={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => void refresh()}
      />
    </div>
  );
}

export { Printer }; // re-exported for the action-button file under detail page