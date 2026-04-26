/** Print Format REST API.
 *
 *  Routes:
 *    GET    /                                     all formats
 *    GET    /:resource                            formats for one resource
 *    GET    /:resource/:id                        single format
 *    POST   /:resource                            create
 *    PATCH  /:resource/:id                        update
 *    DELETE /:resource/:id                        delete
 *    POST   /:resource/:id/render                 render against payload
 *
 *    GET    /letter-heads                         list letter heads
 *    POST   /letter-heads                         create
 *    PATCH  /letter-heads/:id                     update
 *    DELETE /letter-heads/:id                     delete
 */
import { Hono } from "@gutu-host";
import { requireAuth, currentUser } from "@gutu-host";
import { getTenantContext } from "@gutu-host";
import {
  PrintFormatError,
  createLetterHead,
  createPrintFormat,
  deleteLetterHead,
  deletePrintFormat,
  getPrintFormat,
  listLetterHeads,
  listPrintFormats,
  renderPrintFormat,
  updateLetterHead,
  updatePrintFormat,
} from "@gutu-plugin/template-core";
import { recordAudit } from "@gutu-host";

export const printFormatRoutes = new Hono();
printFormatRoutes.use("*", requireAuth);

function tenantId(): string {
  return getTenantContext()?.tenantId ?? "default";
}

/* ---- Letter heads (mounted on the same router under /letter-heads) ---- */

printFormatRoutes.get("/letter-heads", (c) =>
  c.json({ rows: listLetterHeads(tenantId()) }),
);

printFormatRoutes.post("/letter-heads", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    headerHtml?: string;
    footerHtml?: string;
    isDefault?: boolean;
  };
  if (!body.name) return c.json({ error: "name required" }, 400);
  const user = currentUser(c);
  try {
    const lh = createLetterHead({
      tenantId: tenantId(),
      name: body.name,
      headerHtml: body.headerHtml,
      footerHtml: body.footerHtml,
      isDefault: body.isDefault,
      createdBy: user.email,
    });
    recordAudit({
      actor: user.email,
      action: "letter-head.created",
      resource: "letter-head",
      recordId: lh.id,
    });
    return c.json(lh, 201);
  } catch (err) {
    if (err instanceof PrintFormatError)
      return c.json({ error: err.message, code: err.code }, 400);
    throw err;
  }
});

printFormatRoutes.patch("/letter-heads/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    headerHtml?: string | null;
    footerHtml?: string | null;
    isDefault?: boolean;
  };
  const updated = updateLetterHead(tenantId(), c.req.param("id"), body);
  if (!updated) return c.json({ error: "not found" }, 404);
  return c.json(updated);
});

printFormatRoutes.delete("/letter-heads/:id", (c) => {
  const ok = deleteLetterHead(tenantId(), c.req.param("id"));
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

/* ---- Print formats ---- */

printFormatRoutes.get("/", (c) => c.json({ rows: listPrintFormats(tenantId()) }));

printFormatRoutes.get("/:resource", (c) =>
  c.json({ rows: listPrintFormats(tenantId(), c.req.param("resource")) }),
);

printFormatRoutes.get("/:resource/:id", (c) => {
  const fmt = getPrintFormat(tenantId(), c.req.param("id"));
  if (!fmt) return c.json({ error: "not found" }, 404);
  return c.json(fmt);
});

printFormatRoutes.post("/:resource", async (c) => {
  const resource = c.req.param("resource");
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    template?: string;
    paperSize?: string;
    orientation?: "portrait" | "landscape";
    letterheadId?: string | null;
    isDefault?: boolean;
  };
  if (!body.name || !body.template) {
    return c.json({ error: "name and template are required" }, 400);
  }
  const user = currentUser(c);
  try {
    const fmt = createPrintFormat({
      tenantId: tenantId(),
      resource,
      name: body.name,
      template: body.template,
      paperSize: body.paperSize,
      orientation: body.orientation,
      letterheadId: body.letterheadId,
      isDefault: body.isDefault,
      createdBy: user.email,
    });
    recordAudit({
      actor: user.email,
      action: "print-format.created",
      resource: "print-format",
      recordId: fmt.id,
      payload: { resource, name: body.name },
    });
    return c.json(fmt, 201);
  } catch (err) {
    if (err instanceof PrintFormatError)
      return c.json({ error: err.message, code: err.code }, 400);
    throw err;
  }
});

printFormatRoutes.patch("/:resource/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const updated = updatePrintFormat(tenantId(), id, body as never);
  if (!updated) return c.json({ error: "not found" }, 404);
  const user = currentUser(c);
  recordAudit({
    actor: user.email,
    action: "print-format.updated",
    resource: "print-format",
    recordId: id,
  });
  return c.json(updated);
});

printFormatRoutes.delete("/:resource/:id", (c) => {
  const ok = deletePrintFormat(tenantId(), c.req.param("id"));
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

printFormatRoutes.post("/:resource/:id/render", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    record?: Record<string, unknown>;
    context?: Record<string, unknown>;
    letterheadId?: string;
  };
  const out = renderPrintFormat({
    tenantId: tenantId(),
    formatId: c.req.param("id"),
    record: body.record ?? {},
    context: body.context,
    letterheadId: body.letterheadId,
  });
  return c.json(out);
});
