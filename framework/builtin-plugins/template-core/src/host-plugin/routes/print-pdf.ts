/** Server-side PDF / printable HTML route.
 *
 *  POST /render
 *    body: { html?, template?, context?, paperSize?, orientation?, marginMm?, filename? }
 *    Returns either a PDF (when a server-side renderer is registered)
 *    or a printable HTML doc with auto-print on load.
 */

import { Hono } from "@gutu-host";
import { requireAuth } from "@gutu-host";
import { renderPdf, renderTemplateToPrintable } from "@gutu-plugin/template-core";

export const printPdfRoutes = new Hono();
printPdfRoutes.use("*", requireAuth);

printPdfRoutes.post("/render", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let result;
  if (typeof body.template === "string" && body.context && typeof body.context === "object") {
    result = await renderTemplateToPrintable({
      template: body.template,
      context: body.context as Record<string, unknown>,
      paperSize: (body.paperSize as never) ?? undefined,
      orientation: (body.orientation as never) ?? undefined,
      marginMm: typeof body.marginMm === "number" ? body.marginMm : undefined,
    });
  } else if (typeof body.html === "string") {
    result = await renderPdf({
      html: body.html,
      paperSize: (body.paperSize as never) ?? undefined,
      orientation: (body.orientation as never) ?? undefined,
      marginMm: typeof body.marginMm === "number" ? body.marginMm : undefined,
      filename: typeof body.filename === "string" ? body.filename : undefined,
    });
  } else {
    return c.json({ error: "either `template` + `context` or `html` is required" }, 400);
  }

  if (result.kind === "pdf") {
    return new Response(result.body as Uint8Array, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  }
  return new Response(result.body as string, {
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `inline; filename="${result.filename}"`,
    },
  });
});
