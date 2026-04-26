/** Naming Series REST API.
 *
 *  Routes:
 *    GET    /                           all series for the tenant
 *    GET    /:resource                  series for one resource
 *    POST   /:resource                  create a new series
 *    PATCH  /:resource/:id              update label / default flag
 *    DELETE /:resource/:id              remove series + its counters
 *    POST   /:resource/:id/next         atomically allocate next name
 *    POST   /:resource/preview          preview a pattern w/o creating
 */
import { Hono } from "@gutu-host";
import { requireAuth, currentUser } from "@gutu-host";
import { getTenantContext } from "@gutu-host";
import {
  NamingSeriesError,
  bucketFor,
  createNamingSeries,
  deleteNamingSeries,
  formatSeries,
  listNamingSeries,
  nextDocumentName,
  updateNamingSeries,
} from "@gutu-plugin/template-core";
import { recordAudit } from "@gutu-host";

export const namingSeriesRoutes = new Hono();
namingSeriesRoutes.use("*", requireAuth);

function tenantId(): string {
  return getTenantContext()?.tenantId ?? "default";
}

namingSeriesRoutes.get("/", (c) => c.json({ rows: listNamingSeries(tenantId()) }));

namingSeriesRoutes.get("/:resource", (c) =>
  c.json({ rows: listNamingSeries(tenantId(), c.req.param("resource")) }),
);

namingSeriesRoutes.post("/:resource", async (c) => {
  const resource = c.req.param("resource");
  const body = (await c.req.json().catch(() => ({}))) as {
    pattern?: string;
    label?: string;
    isDefault?: boolean;
  };
  if (!body.pattern) {
    return c.json({ error: "pattern is required", code: "invalid-argument" }, 400);
  }
  const user = currentUser(c);
  try {
    const created = createNamingSeries({
      tenantId: tenantId(),
      resource,
      pattern: body.pattern,
      label: body.label,
      isDefault: body.isDefault,
      createdBy: user.email,
    });
    recordAudit({
      actor: user.email,
      action: "naming-series.created",
      resource: "naming-series",
      recordId: created.id,
      payload: { resource, pattern: body.pattern },
    });
    return c.json(created, 201);
  } catch (err) {
    if (err instanceof NamingSeriesError) {
      return c.json({ error: err.message, code: err.code }, 400);
    }
    throw err;
  }
});

namingSeriesRoutes.patch("/:resource/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    label?: string | null;
    isDefault?: boolean;
  };
  const updated = updateNamingSeries(tenantId(), id, body);
  if (!updated) return c.json({ error: "not found" }, 404);
  const user = currentUser(c);
  recordAudit({
    actor: user.email,
    action: "naming-series.updated",
    resource: "naming-series",
    recordId: id,
  });
  return c.json(updated);
});

namingSeriesRoutes.delete("/:resource/:id", (c) => {
  const ok = deleteNamingSeries(tenantId(), c.req.param("id"));
  if (!ok) return c.json({ error: "not found" }, 404);
  const user = currentUser(c);
  recordAudit({
    actor: user.email,
    action: "naming-series.deleted",
    resource: "naming-series",
    recordId: c.req.param("id"),
  });
  return c.json({ ok: true });
});

namingSeriesRoutes.post("/:resource/:id/next", (c) => {
  try {
    const out = nextDocumentName(tenantId(), c.req.param("id"));
    return c.json(out);
  } catch (err) {
    if (err instanceof NamingSeriesError) {
      return c.json({ error: err.message, code: err.code }, 400);
    }
    throw err;
  }
});

namingSeriesRoutes.post("/:resource/preview", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { pattern?: string };
  if (!body.pattern) return c.json({ error: "pattern required" }, 400);
  const when = new Date();
  // Show three sample names with counters 1/2/3.
  return c.json({
    bucket: bucketFor(body.pattern, when),
    samples: [1, 2, 3].map((n) => formatSeries(body.pattern!, n, when)),
  });
});
