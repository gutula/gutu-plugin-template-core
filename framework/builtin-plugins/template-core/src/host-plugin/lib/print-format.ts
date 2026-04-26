/** Print Format runtime helpers.
 *
 *  Print formats are tenant-scoped HTML templates rendered via the
 *  shared template engine (template-engine.ts). Storage:
 *    - print_formats: id, resource, name, template (HTML), paper_size,
 *      orientation, letterhead_id, default flag
 *    - letter_heads: id, name, header_html, footer_html, default flag
 *
 *  Render: substitutes the template against the record data + context,
 *  injects letterhead, returns a printable HTML string. PDF generation
 *  is left to the browser (window.print()) — that keeps the backend
 *  dependency-free; a server-side PDF lane can be added later by
 *  passing the same HTML to puppeteer/wkhtmltopdf. */

import { db, nowIso } from "@gutu-host";
import { uuid } from "@gutu-host";
import { renderTemplate, escapeHtml } from "@gutu-plugin/template-core";

export interface PrintFormat {
  id: string;
  tenantId: string;
  resource: string;
  name: string;
  template: string;
  paperSize: string;
  orientation: "portrait" | "landscape";
  letterheadId: string | null;
  isDefault: boolean;
  disabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface LetterHead {
  id: string;
  tenantId: string;
  name: string;
  headerHtml: string | null;
  footerHtml: string | null;
  isDefault: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface PfRow {
  id: string;
  tenant_id: string;
  resource: string;
  name: string;
  template: string;
  paper_size: string;
  orientation: string;
  letterhead_id: string | null;
  is_default: number;
  disabled: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface LhRow {
  id: string;
  tenant_id: string;
  name: string;
  header_html: string | null;
  footer_html: string | null;
  is_default: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export class PrintFormatError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "PrintFormatError";
  }
}

function pfRow(r: PfRow): PrintFormat {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    resource: r.resource,
    name: r.name,
    template: r.template,
    paperSize: r.paper_size,
    orientation: r.orientation === "landscape" ? "landscape" : "portrait",
    letterheadId: r.letterhead_id,
    isDefault: r.is_default === 1,
    disabled: r.disabled === 1,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function lhRow(r: LhRow): LetterHead {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    headerHtml: r.header_html,
    footerHtml: r.footer_html,
    isDefault: r.is_default === 1,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ----------------------------- Print Formats ----------------------------- */

export function listPrintFormats(tenantId: string, resource?: string): PrintFormat[] {
  const rows = resource
    ? (db
        .prepare(
          `SELECT * FROM print_formats WHERE tenant_id = ? AND resource = ?
           ORDER BY is_default DESC, name ASC`,
        )
        .all(tenantId, resource) as PfRow[])
    : (db
        .prepare(
          `SELECT * FROM print_formats WHERE tenant_id = ?
           ORDER BY resource ASC, name ASC`,
        )
        .all(tenantId) as PfRow[]);
  return rows.map(pfRow);
}

export function getPrintFormat(tenantId: string, id: string): PrintFormat | null {
  const r = db
    .prepare(`SELECT * FROM print_formats WHERE id = ? AND tenant_id = ?`)
    .get(id, tenantId) as PfRow | undefined;
  return r ? pfRow(r) : null;
}

export interface CreatePrintFormatArgs {
  tenantId: string;
  resource: string;
  name: string;
  template: string;
  paperSize?: string;
  orientation?: "portrait" | "landscape";
  letterheadId?: string | null;
  isDefault?: boolean;
  createdBy: string;
}

export function createPrintFormat(args: CreatePrintFormatArgs): PrintFormat {
  if (!args.name || args.name.length > 100) {
    throw new PrintFormatError("invalid-name", "Name is required (max 100 chars)");
  }
  if (!args.template) {
    throw new PrintFormatError("invalid-template", "Template body is required");
  }
  const id = uuid();
  const now = nowIso();
  if (args.isDefault) {
    db.prepare(
      `UPDATE print_formats SET is_default = 0, updated_at = ?
       WHERE tenant_id = ? AND resource = ?`,
    ).run(now, args.tenantId, args.resource);
  }
  try {
    db.prepare(
      `INSERT INTO print_formats
        (id, tenant_id, resource, name, template, paper_size, orientation, letterhead_id, is_default, disabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(
      id,
      args.tenantId,
      args.resource,
      args.name,
      args.template,
      args.paperSize ?? "A4",
      args.orientation ?? "portrait",
      args.letterheadId ?? null,
      args.isDefault ? 1 : 0,
      args.createdBy,
      now,
      now,
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      throw new PrintFormatError(
        "duplicate",
        `Print format "${args.name}" already exists for ${args.resource}`,
      );
    }
    throw err;
  }
  const row = db.prepare(`SELECT * FROM print_formats WHERE id = ?`).get(id) as PfRow;
  return pfRow(row);
}

export interface UpdatePrintFormatArgs {
  name?: string;
  template?: string;
  paperSize?: string;
  orientation?: "portrait" | "landscape";
  letterheadId?: string | null;
  isDefault?: boolean;
  disabled?: boolean;
}

export function updatePrintFormat(
  tenantId: string,
  id: string,
  patch: UpdatePrintFormatArgs,
): PrintFormat | null {
  const existing = db
    .prepare(`SELECT * FROM print_formats WHERE id = ? AND tenant_id = ?`)
    .get(id, tenantId) as PfRow | undefined;
  if (!existing) return null;
  const now = nowIso();
  const fields: string[] = [];
  const args: unknown[] = [];
  if (patch.name !== undefined) {
    fields.push("name = ?");
    args.push(patch.name);
  }
  if (patch.template !== undefined) {
    fields.push("template = ?");
    args.push(patch.template);
  }
  if (patch.paperSize !== undefined) {
    fields.push("paper_size = ?");
    args.push(patch.paperSize);
  }
  if (patch.orientation !== undefined) {
    fields.push("orientation = ?");
    args.push(patch.orientation);
  }
  if (patch.letterheadId !== undefined) {
    fields.push("letterhead_id = ?");
    args.push(patch.letterheadId);
  }
  if (patch.isDefault !== undefined) {
    if (patch.isDefault) {
      db.prepare(
        `UPDATE print_formats SET is_default = 0, updated_at = ?
         WHERE tenant_id = ? AND resource = ? AND id != ?`,
      ).run(now, tenantId, existing.resource, id);
    }
    fields.push("is_default = ?");
    args.push(patch.isDefault ? 1 : 0);
  }
  if (patch.disabled !== undefined) {
    fields.push("disabled = ?");
    args.push(patch.disabled ? 1 : 0);
  }
  if (fields.length === 0) return pfRow(existing);
  fields.push("updated_at = ?");
  args.push(now);
  args.push(id);
  db.prepare(`UPDATE print_formats SET ${fields.join(", ")} WHERE id = ?`).run(...args);
  const row = db.prepare(`SELECT * FROM print_formats WHERE id = ?`).get(id) as PfRow;
  return pfRow(row);
}

export function deletePrintFormat(tenantId: string, id: string): boolean {
  const r = db.prepare(`DELETE FROM print_formats WHERE id = ? AND tenant_id = ?`)
    .run(id, tenantId);
  return r.changes > 0;
}

/* ----------------------------- Letter Heads ------------------------------ */

export function listLetterHeads(tenantId: string): LetterHead[] {
  const rows = db
    .prepare(`SELECT * FROM letter_heads WHERE tenant_id = ? ORDER BY name ASC`)
    .all(tenantId) as LhRow[];
  return rows.map(lhRow);
}

export function getLetterHead(tenantId: string, id: string): LetterHead | null {
  const r = db.prepare(`SELECT * FROM letter_heads WHERE id = ? AND tenant_id = ?`)
    .get(id, tenantId) as LhRow | undefined;
  return r ? lhRow(r) : null;
}

export interface CreateLetterHeadArgs {
  tenantId: string;
  name: string;
  headerHtml?: string;
  footerHtml?: string;
  isDefault?: boolean;
  createdBy: string;
}

export function createLetterHead(args: CreateLetterHeadArgs): LetterHead {
  if (!args.name) throw new PrintFormatError("invalid-name", "Letter head name required");
  const id = uuid();
  const now = nowIso();
  if (args.isDefault) {
    db.prepare(
      `UPDATE letter_heads SET is_default = 0, updated_at = ? WHERE tenant_id = ?`,
    ).run(now, args.tenantId);
  }
  try {
    db.prepare(
      `INSERT INTO letter_heads
        (id, tenant_id, name, header_html, footer_html, is_default, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      args.tenantId,
      args.name,
      args.headerHtml ?? null,
      args.footerHtml ?? null,
      args.isDefault ? 1 : 0,
      args.createdBy,
      now,
      now,
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      throw new PrintFormatError("duplicate", `Letter head "${args.name}" already exists`);
    }
    throw err;
  }
  const row = db.prepare(`SELECT * FROM letter_heads WHERE id = ?`).get(id) as LhRow;
  return lhRow(row);
}

export function updateLetterHead(
  tenantId: string,
  id: string,
  patch: { name?: string; headerHtml?: string | null; footerHtml?: string | null; isDefault?: boolean },
): LetterHead | null {
  const existing = db.prepare(`SELECT * FROM letter_heads WHERE id = ? AND tenant_id = ?`)
    .get(id, tenantId) as LhRow | undefined;
  if (!existing) return null;
  const now = nowIso();
  const fields: string[] = [];
  const args: unknown[] = [];
  if (patch.name !== undefined) { fields.push("name = ?"); args.push(patch.name); }
  if (patch.headerHtml !== undefined) { fields.push("header_html = ?"); args.push(patch.headerHtml); }
  if (patch.footerHtml !== undefined) { fields.push("footer_html = ?"); args.push(patch.footerHtml); }
  if (patch.isDefault !== undefined) {
    if (patch.isDefault) {
      db.prepare(`UPDATE letter_heads SET is_default = 0, updated_at = ? WHERE tenant_id = ? AND id != ?`)
        .run(now, tenantId, id);
    }
    fields.push("is_default = ?"); args.push(patch.isDefault ? 1 : 0);
  }
  if (fields.length === 0) return lhRow(existing);
  fields.push("updated_at = ?"); args.push(now);
  args.push(id);
  db.prepare(`UPDATE letter_heads SET ${fields.join(", ")} WHERE id = ?`).run(...args);
  const r = db.prepare(`SELECT * FROM letter_heads WHERE id = ?`).get(id) as LhRow;
  return lhRow(r);
}

export function deleteLetterHead(tenantId: string, id: string): boolean {
  const r = db.prepare(`DELETE FROM letter_heads WHERE id = ? AND tenant_id = ?`)
    .run(id, tenantId);
  return r.changes > 0;
}

/* ----------------------------- Render ------------------------------------ */

export interface RenderInput {
  tenantId: string;
  formatId: string;
  /** The record body to render against. */
  record: Record<string, unknown>;
  /** Extra context (company name, currency, locale, user). */
  context?: Record<string, unknown>;
  /** Override letterhead. */
  letterheadId?: string;
}

export interface RenderOutput {
  html: string;
  errors: Array<{ message: string; near: string }>;
  paperSize: string;
  orientation: "portrait" | "landscape";
}

const PAGE_CSS = `
  @page { margin: 18mm; }
  html, body { font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; color: #111; }
  body { font-size: 12px; line-height: 1.45; margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
  thead { background: #f3f4f6; }
  h1, h2, h3 { margin: 8px 0; }
  .pf-header, .pf-footer { padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
  .pf-footer { border-top: 1px solid #e5e7eb; border-bottom: 0; margin-top: 24px; }
  .pf-amount { text-align: right; font-variant-numeric: tabular-nums; }
  @media print {
    .no-print { display: none; }
  }
`;

export function renderPrintFormat(input: RenderInput): RenderOutput {
  const fmt = getPrintFormat(input.tenantId, input.formatId);
  if (!fmt) {
    return {
      html: `<!doctype html><html><body>Print format not found.</body></html>`,
      errors: [{ message: "Print format not found", near: "(meta)" }],
      paperSize: "A4",
      orientation: "portrait",
    };
  }
  const letterheadId = input.letterheadId ?? fmt.letterheadId ?? null;
  const lh = letterheadId ? getLetterHead(input.tenantId, letterheadId) : null;
  const ctx: Record<string, unknown> = {
    ...input.context,
    record: input.record,
    // Convenience: spread record fields as well so templates can write
    // {{ customer_name }} instead of {{ record.customer_name }}.
    ...input.record,
    now: new Date().toISOString(),
  };
  const body = renderTemplate(fmt.template, ctx, {
    currency: typeof input.context?.currency === "string" ? (input.context.currency as string) : "USD",
  });
  const header = lh?.headerHtml
    ? renderTemplate(lh.headerHtml, ctx, {}).output
    : "";
  const footer = lh?.footerHtml
    ? renderTemplate(lh.footerHtml, ctx, {}).output
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(fmt.name)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
${header ? `<div class="pf-header">${header}</div>` : ""}
<main>${body.output}</main>
${footer ? `<div class="pf-footer">${footer}</div>` : ""}
</body>
</html>`;
  return {
    html,
    errors: body.errors,
    paperSize: fmt.paperSize,
    orientation: fmt.orientation,
  };
}
