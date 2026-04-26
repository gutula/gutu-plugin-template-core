/** Naming Series runtime helpers.
 *
 *  A naming series is a pattern like 'INV-.YYYY.-.#####' that resolves
 *  to deterministic strings ('INV-2026-00001', 'INV-2026-00002', …).
 *  Patterns support these tokens:
 *
 *    .YYYY.   four-digit year
 *    .YY.     two-digit year
 *    .MM.     two-digit month
 *    .DD.     two-digit day
 *    .FY.     fiscal year (calendar year if no fiscal config)
 *    .#####   counter, padded to the count of #s
 *
 *  The counter is keyed by (tenant, series, bucket). The bucket is the
 *  prefix-up-to-counter token (so '.YYYY.' resets every year, etc.).
 *
 *  The next() function is a *transaction*: it atomically picks the next
 *  counter and bumps the row, so concurrent callers never collide.
 */

import { db, nowIso } from "@gutu-host";
import { uuid } from "@gutu-host";

export interface NamingSeries {
  id: string;
  tenantId: string;
  resource: string;
  pattern: string;
  label: string | null;
  isDefault: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  tenant_id: string;
  resource: string;
  pattern: string;
  label: string | null;
  is_default: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export class NamingSeriesError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "NamingSeriesError";
  }
}

function rowToObj(r: Row): NamingSeries {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    resource: r.resource,
    pattern: r.pattern,
    label: r.label,
    isDefault: r.is_default === 1,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listNamingSeries(tenantId: string, resource?: string): NamingSeries[] {
  const rows = resource
    ? (db
        .prepare(
          `SELECT * FROM naming_series WHERE tenant_id = ? AND resource = ?
           ORDER BY is_default DESC, pattern ASC`,
        )
        .all(tenantId, resource) as Row[])
    : (db
        .prepare(
          `SELECT * FROM naming_series WHERE tenant_id = ?
           ORDER BY resource ASC, pattern ASC`,
        )
        .all(tenantId) as Row[]);
  return rows.map(rowToObj);
}

export interface CreateArgs {
  tenantId: string;
  resource: string;
  pattern: string;
  label?: string;
  isDefault?: boolean;
  createdBy: string;
}

const VALID_PATTERN_TOKEN_RE = /^[\w\-./.#]*$/;

function validatePattern(pattern: string): void {
  if (!pattern || pattern.length > 200) {
    throw new NamingSeriesError("invalid-pattern", "Pattern must be 1–200 characters");
  }
  // Patterns are quite permissive — letters, digits, dashes, slashes,
  // dots and #. Rejecting unbalanced tokens is best-effort at format()
  // time. Here we just reject obviously dangerous chars.
  if (!VALID_PATTERN_TOKEN_RE.test(pattern)) {
    throw new NamingSeriesError(
      "invalid-pattern",
      "Pattern may only contain letters, digits, dashes, dots, slashes and #",
    );
  }
  if (!pattern.includes("#")) {
    throw new NamingSeriesError(
      "invalid-pattern",
      "Pattern must include a counter (one or more '#') so the result is unique",
    );
  }
}

export function createNamingSeries(args: CreateArgs): NamingSeries {
  validatePattern(args.pattern);
  const now = nowIso();
  const id = uuid();
  // Ensure single default per (tenant, resource).
  if (args.isDefault) {
    db.prepare(
      `UPDATE naming_series SET is_default = 0, updated_at = ?
       WHERE tenant_id = ? AND resource = ?`,
    ).run(now, args.tenantId, args.resource);
  }
  try {
    db.prepare(
      `INSERT INTO naming_series
         (id, tenant_id, resource, pattern, label, is_default, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      args.tenantId,
      args.resource,
      args.pattern,
      args.label ?? null,
      args.isDefault ? 1 : 0,
      args.createdBy,
      now,
      now,
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      throw new NamingSeriesError(
        "duplicate",
        `Series "${args.pattern}" already exists for ${args.resource}`,
      );
    }
    throw err;
  }
  const row = db.prepare(`SELECT * FROM naming_series WHERE id = ?`).get(id) as Row;
  return rowToObj(row);
}

export interface UpdateArgs {
  label?: string | null;
  isDefault?: boolean;
}

export function updateNamingSeries(
  tenantId: string,
  id: string,
  patch: UpdateArgs,
): NamingSeries | null {
  const existing = db
    .prepare(`SELECT * FROM naming_series WHERE id = ? AND tenant_id = ?`)
    .get(id, tenantId) as Row | undefined;
  if (!existing) return null;
  const now = nowIso();
  const fields: string[] = [];
  const args: unknown[] = [];
  if (patch.label !== undefined) {
    fields.push("label = ?");
    args.push(patch.label);
  }
  if (patch.isDefault !== undefined) {
    if (patch.isDefault) {
      db.prepare(
        `UPDATE naming_series SET is_default = 0, updated_at = ?
         WHERE tenant_id = ? AND resource = ? AND id != ?`,
      ).run(now, tenantId, existing.resource, id);
    }
    fields.push("is_default = ?");
    args.push(patch.isDefault ? 1 : 0);
  }
  if (fields.length === 0) return rowToObj(existing);
  fields.push("updated_at = ?");
  args.push(now);
  args.push(id);
  db.prepare(`UPDATE naming_series SET ${fields.join(", ")} WHERE id = ?`).run(...args);
  const row = db.prepare(`SELECT * FROM naming_series WHERE id = ?`).get(id) as Row;
  return rowToObj(row);
}

export function deleteNamingSeries(tenantId: string, id: string): boolean {
  const r = db
    .prepare(`DELETE FROM naming_series WHERE id = ? AND tenant_id = ?`)
    .run(id, tenantId);
  if (r.changes > 0) {
    db.prepare(`DELETE FROM naming_series_counters WHERE tenant_id = ? AND series_id = ?`)
      .run(tenantId, id);
  }
  return r.changes > 0;
}

/** Compute the bucket key for a pattern + Date. Bucket = the part of
 *  the pattern that *changes* with time. e.g.
 *    'INV-.YYYY.-.#####' on 2026-04 → bucket '2026'
 *    'INV-.YYYY.-.MM.-.#####' on 2026-04 → bucket '2026-04'
 *  When no time tokens are present, the bucket is just '*' (counter
 *  monotonically increases forever). */
export function bucketFor(pattern: string, when: Date): string {
  const yyyy = String(when.getUTCFullYear());
  const yy = yyyy.slice(2);
  const mm = String(when.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(when.getUTCDate()).padStart(2, "0");
  const fy = yyyy; // simplification: fiscal year = calendar year
  const parts: string[] = [];
  if (pattern.includes(".YYYY.")) parts.push(yyyy);
  if (pattern.includes(".YY.")) parts.push(yy);
  if (pattern.includes(".MM.")) parts.push(mm);
  if (pattern.includes(".DD.")) parts.push(dd);
  if (pattern.includes(".FY.")) parts.push(fy);
  return parts.length === 0 ? "*" : parts.join("-");
}

/** Format a pattern + counter into a final string. */
export function formatSeries(pattern: string, counter: number, when: Date): string {
  const yyyy = String(when.getUTCFullYear());
  const yy = yyyy.slice(2);
  const mm = String(when.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(when.getUTCDate()).padStart(2, "0");
  let s = pattern
    .replaceAll(".YYYY.", yyyy)
    .replaceAll(".YY.", yy)
    .replaceAll(".MM.", mm)
    .replaceAll(".DD.", dd)
    .replaceAll(".FY.", yyyy);
  // Replace runs of '#' with the zero-padded counter.
  s = s.replace(/#+/g, (run) => String(counter).padStart(run.length, "0"));
  return s;
}

/** Atomically get the next document name for a series. */
export function nextDocumentName(
  tenantId: string,
  seriesId: string,
  when: Date = new Date(),
): { id: string; counter: number; bucket: string; pattern: string; name: string } {
  const series = db
    .prepare(`SELECT * FROM naming_series WHERE id = ? AND tenant_id = ?`)
    .get(seriesId, tenantId) as Row | undefined;
  if (!series) {
    throw new NamingSeriesError("not-found", "Naming series not found");
  }
  const bucket = bucketFor(series.pattern, when);
  const tx = db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT counter FROM naming_series_counters
         WHERE tenant_id = ? AND series_id = ? AND bucket = ?`,
      )
      .get(tenantId, seriesId, bucket) as { counter: number } | undefined;
    const next = (existing?.counter ?? 0) + 1;
    if (existing) {
      db.prepare(
        `UPDATE naming_series_counters SET counter = ?, updated_at = ?
         WHERE tenant_id = ? AND series_id = ? AND bucket = ?`,
      ).run(next, nowIso(), tenantId, seriesId, bucket);
    } else {
      db.prepare(
        `INSERT INTO naming_series_counters (tenant_id, series_id, bucket, counter, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(tenantId, seriesId, bucket, next, nowIso());
    }
    return next;
  });
  const counter = tx();
  return {
    id: seriesId,
    counter,
    bucket,
    pattern: series.pattern,
    name: formatSeries(series.pattern, counter, when),
  };
}

/** Pick the default series for a resource (or the first by pattern), if any. */
export function defaultSeriesForResource(
  tenantId: string,
  resource: string,
): NamingSeries | null {
  const all = listNamingSeries(tenantId, resource);
  if (all.length === 0) return null;
  return all.find((s) => s.isDefault) ?? all[0]!;
}

/** Convenience: bake-in the default for a resource and return name. */
export function nextNameForResource(
  tenantId: string,
  resource: string,
  when: Date = new Date(),
): string | null {
  const series = defaultSeriesForResource(tenantId, resource);
  if (!series) return null;
  return nextDocumentName(tenantId, series.id, when).name;
}
