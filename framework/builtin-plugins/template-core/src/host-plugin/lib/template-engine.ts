/** Minimal Jinja-like template engine.
 *
 *  Shared by print formats and notification rules. Keeps the surface
 *  *much* smaller than full Jinja (no inheritance, no macros, no auto-
 *  escape switching) but supports enough for invoice / email templates:
 *
 *    {{ field.path }}                  scalar interpolation, dot paths
 *    {{ field | filter }}              one filter ('upper'|'lower'|
 *                                       'currency'|'date'|'json'|'safe')
 *    {{ field | default("—") }}        default when field is null/undef
 *    {% if expr %}…{% endif %}         conditional, expr supports == != < <= > >=
 *    {% if x %}…{% else %}…{% endif %} else branch
 *    {% for x in items %}…{% endfor %} loops with {{ x }}, {{ loop.index }}, loop.first/last
 *
 *  Output is HTML-escaped by default. The 'safe' filter opts a value
 *  out of escaping (e.g. for already-rendered fragments). 'json' renders
 *  via JSON.stringify (also escaped).
 *
 *  Errors during render are surfaced as plain text in-place ('{{ error }}')
 *  rather than throwing — a missing field shouldn't block a print job. */

export interface RenderContext {
  [key: string]: unknown;
}

export interface RenderOptions {
  /** Currency code for the 'currency' filter when none is supplied via
   *  filter args. */
  currency?: string;
  /** Date format for the 'date' filter when none is supplied. */
  dateFormat?: string;
  /** When true, capture each error rather than embedding into output. */
  collectErrors?: boolean;
}

export interface RenderResult {
  output: string;
  errors: Array<{ message: string; near: string }>;
}

export function renderTemplate(
  template: string,
  context: RenderContext,
  options: RenderOptions = {},
): RenderResult {
  const errors: RenderResult["errors"] = [];
  try {
    const ast = parse(template);
    const out = renderNodes(ast, context, options, errors);
    return { output: out, errors };
  } catch (err) {
    errors.push({ message: err instanceof Error ? err.message : String(err), near: "(template)" });
    return { output: template, errors };
  }
}

/* ----------------------------- AST --------------------------------------- */

type Node =
  | { type: "text"; value: string }
  | { type: "expr"; expr: string }
  | { type: "if"; cond: string; then: Node[]; else: Node[] }
  | { type: "for"; varName: string; iter: string; body: Node[] };

const TAG_RE = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g;

function parse(template: string): Node[] {
  const tokens = tokenize(template);
  const [nodes, idx] = parseBlock(tokens, 0, null);
  if (idx !== tokens.length) {
    throw new Error("Unexpected trailing tokens in template");
  }
  return nodes;
}

interface Token {
  kind: "text" | "expr" | "tag";
  raw: string;
  inner?: string;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(src))) {
    if (m.index > i) {
      out.push({ kind: "text", raw: src.slice(i, m.index) });
    }
    const raw = m[0];
    if (raw.startsWith("{{")) {
      out.push({ kind: "expr", raw, inner: raw.slice(2, -2).trim() });
    } else {
      out.push({ kind: "tag", raw, inner: raw.slice(2, -2).trim() });
    }
    i = m.index + raw.length;
  }
  if (i < src.length) out.push({ kind: "text", raw: src.slice(i) });
  return out;
}

type Stop = "endif" | "else" | "endfor" | null;

function parseBlock(tokens: Token[], start: number, stopAt: Stop): [Node[], number] {
  const nodes: Node[] = [];
  let i = start;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.kind === "text") {
      nodes.push({ type: "text", value: t.raw });
      i++;
      continue;
    }
    if (t.kind === "expr") {
      nodes.push({ type: "expr", expr: t.inner ?? "" });
      i++;
      continue;
    }
    // tag
    const inner = t.inner ?? "";
    if (stopAt && (inner === stopAt || (stopAt === "endif" && inner === "else"))) {
      return [nodes, i];
    }
    if (inner.startsWith("if ")) {
      const cond = inner.slice(3).trim();
      const [thenNodes, j] = parseBlock(tokens, i + 1, "endif");
      let elseNodes: Node[] = [];
      let endIdx = j;
      if (j < tokens.length && tokens[j]!.kind === "tag" && tokens[j]!.inner === "else") {
        const [n, k] = parseBlock(tokens, j + 1, "endif");
        elseNodes = n;
        endIdx = k;
      }
      if (endIdx >= tokens.length || tokens[endIdx]!.inner !== "endif") {
        throw new Error("Unterminated {% if %}");
      }
      nodes.push({ type: "if", cond, then: thenNodes, else: elseNodes });
      i = endIdx + 1;
      continue;
    }
    if (inner.startsWith("for ")) {
      const m = /^for\s+(\w+)\s+in\s+(.+)$/.exec(inner);
      if (!m) throw new Error(`Bad for tag: ${inner}`);
      const [, varName, iterExpr] = m;
      const [body, j] = parseBlock(tokens, i + 1, "endfor");
      if (j >= tokens.length) throw new Error("Unterminated {% for %}");
      nodes.push({ type: "for", varName: varName!, iter: iterExpr!.trim(), body });
      i = j + 1;
      continue;
    }
    if (inner === "endif" || inner === "endfor" || inner === "else") {
      // End tag without matching open — treat as raw text rather than
      // crash a print job.
      nodes.push({ type: "text", value: t.raw });
      i++;
      continue;
    }
    // Unknown tag — render as text.
    nodes.push({ type: "text", value: t.raw });
    i++;
  }
  if (stopAt) {
    // If we ran out of tokens looking for the end tag, that's fatal.
    throw new Error(`Unterminated block (expected {% ${stopAt} %})`);
  }
  return [nodes, i];
}

/* ----------------------------- Evaluator --------------------------------- */

function renderNodes(
  nodes: Node[],
  ctx: RenderContext,
  opts: RenderOptions,
  errors: RenderResult["errors"],
): string {
  let out = "";
  for (const n of nodes) out += renderNode(n, ctx, opts, errors);
  return out;
}

function renderNode(
  n: Node,
  ctx: RenderContext,
  opts: RenderOptions,
  errors: RenderResult["errors"],
): string {
  switch (n.type) {
    case "text":
      return n.value;
    case "expr":
      try {
        const v = evalExpression(n.expr, ctx, opts);
        return v === null || v === undefined ? "" : String(v);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ message: msg, near: `{{ ${n.expr} }}` });
        return opts.collectErrors ? "" : `[err: ${escapeHtml(msg)}]`;
      }
    case "if": {
      let truthy = false;
      try {
        truthy = isTruthy(evalCondition(n.cond, ctx));
      } catch (err) {
        errors.push({
          message: err instanceof Error ? err.message : String(err),
          near: `{% if ${n.cond} %}`,
        });
      }
      return renderNodes(truthy ? n.then : n.else, ctx, opts, errors);
    }
    case "for": {
      let arr: unknown;
      try {
        arr = evalExpression(n.iter, ctx, opts);
      } catch (err) {
        errors.push({
          message: err instanceof Error ? err.message : String(err),
          near: `{% for … in ${n.iter} %}`,
        });
        return "";
      }
      if (!Array.isArray(arr)) return "";
      let buf = "";
      for (let i = 0; i < arr.length; i++) {
        const innerCtx: RenderContext = {
          ...ctx,
          [n.varName]: arr[i],
          loop: { index: i + 1, index0: i, first: i === 0, last: i === arr.length - 1 },
        };
        buf += renderNodes(n.body, innerCtx, opts, errors);
      }
      return buf;
    }
  }
}

function evalExpression(expr: string, ctx: RenderContext, opts: RenderOptions): unknown {
  // Parse pipe filters: 'field.path | filter | filter("arg")'
  const parts = splitPipes(expr);
  let value = lookup(parts[0]!.trim(), ctx);
  for (let i = 1; i < parts.length; i++) {
    value = applyFilter(value, parts[i]!.trim(), ctx, opts);
  }
  // Auto-escape unless the last filter was 'safe'.
  if (typeof value === "string" && !parts.some((p) => /^safe\b/.test(p.trim()))) {
    return escapeHtml(value);
  }
  return value;
}

function splitPipes(expr: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (const ch of expr) {
    if (inStr) {
      buf += ch;
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "|" && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function lookup(path: string, ctx: RenderContext): unknown {
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  // Literal forms: numbers, strings.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  // Path lookup.
  const parts = trimmed.split(".");
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const FILTERS: Record<string, (input: unknown, args: unknown[], opts: RenderOptions) => unknown> = {
  upper: (v) => (typeof v === "string" ? v.toUpperCase() : v),
  lower: (v) => (typeof v === "string" ? v.toLowerCase() : v),
  capitalize: (v) =>
    typeof v === "string" && v.length > 0 ? v[0]!.toUpperCase() + v.slice(1) : v,
  trim: (v) => (typeof v === "string" ? v.trim() : v),
  default: (v, args) => (v == null || v === "" ? args[0] : v),
  json: (v) => JSON.stringify(v ?? null),
  safe: (v) => v,
  date: (v, args, opts) => {
    if (!v) return "";
    const d = typeof v === "string" || typeof v === "number" ? new Date(v) : (v as Date);
    if (Number.isNaN(d.getTime())) return String(v);
    const fmt = (typeof args[0] === "string" ? args[0] : opts.dateFormat) ?? "YYYY-MM-DD";
    return formatDate(d, fmt);
  },
  currency: (v, args, opts) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return String(v ?? "");
    const code = (typeof args[0] === "string" ? args[0] : opts.currency) ?? "USD";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(n);
  },
  number: (v, args) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return String(v ?? "");
    const digits = typeof args[0] === "number" ? args[0] : 2;
    return n.toFixed(digits);
  },
  truncate: (v, args) => {
    const n = typeof args[0] === "number" ? args[0] : 80;
    if (typeof v !== "string") return v;
    return v.length > n ? `${v.slice(0, n)}…` : v;
  },
};

function applyFilter(value: unknown, expr: string, ctx: RenderContext, opts: RenderOptions): unknown {
  const m = /^(\w+)\s*(?:\((.*)\))?\s*$/.exec(expr);
  if (!m) throw new Error(`Bad filter: ${expr}`);
  const [, name, argsRaw] = m;
  const fn = FILTERS[name!];
  if (!fn) throw new Error(`Unknown filter: ${name}`);
  const args: unknown[] = [];
  if (argsRaw) {
    // Args support: numbers, strings, and literal references.
    for (const part of splitArgs(argsRaw)) {
      args.push(lookup(part, ctx));
    }
  }
  return fn(value, args, opts);
}

function splitArgs(input: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inStr: '"' | "'" | null = null;
  for (const ch of input) {
    if (inStr) {
      buf += ch;
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
      continue;
    }
    if (ch === ",") {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function evalCondition(expr: string, ctx: RenderContext): unknown {
  // Operators (in priority order): ==, !=, >=, <=, >, <, &&, ||
  // Naive shunting — we allow exactly one binary operator per expression
  // for predictability. For complex conditions, encode in the data.
  const operators = ["==", "!=", ">=", "<=", ">", "<"];
  for (const op of operators) {
    const idx = findTopLevel(expr, op);
    if (idx > -1) {
      const left = lookup(expr.slice(0, idx).trim(), ctx);
      const right = lookup(expr.slice(idx + op.length).trim(), ctx);
      switch (op) {
        case "==":
          return left == right; // eslint-disable-line eqeqeq
        case "!=":
          return left != right; // eslint-disable-line eqeqeq
        case ">=":
          return Number(left) >= Number(right);
        case "<=":
          return Number(left) <= Number(right);
        case ">":
          return Number(left) > Number(right);
        case "<":
          return Number(left) < Number(right);
      }
    }
  }
  // Bare truthiness.
  return lookup(expr, ctx);
}

function findTopLevel(expr: string, op: string): number {
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i <= expr.length - op.length; i++) {
    const ch = expr[i]!;
    if (inStr) {
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && expr.slice(i, i + op.length) === op) return i;
  }
  return -1;
}

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESC[ch] ?? ch);
}

function formatDate(d: Date, fmt: string): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return fmt
    .replaceAll("YYYY", String(d.getUTCFullYear()))
    .replaceAll("YY", String(d.getUTCFullYear()).slice(2))
    .replaceAll("MM", pad(d.getUTCMonth() + 1))
    .replaceAll("DD", pad(d.getUTCDate()))
    .replaceAll("HH", pad(d.getUTCHours()))
    .replaceAll("mm", pad(d.getUTCMinutes()))
    .replaceAll("ss", pad(d.getUTCSeconds()));
}
