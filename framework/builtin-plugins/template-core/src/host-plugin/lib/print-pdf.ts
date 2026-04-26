/** Server-side PDF rendering helper.
 *
 *  We avoid pulling in puppeteer / chromium / wkhtmltopdf to keep the
 *  install footprint minimal. Instead, we produce a self-contained
 *  printable HTML document with embedded `@page` CSS so:
 *
 *    - Opening it in a browser triggers an automatic `window.print()`,
 *      so the user can save-as-PDF in one click.
 *    - The PDF lifecycle is consistent with the in-browser Print
 *      action shipped on RichDetailPage.
 *
 *  When a deployment requires server-side PDF bytes, plug in an
 *  optional adapter (puppeteer/playwright) via the `pdfRenderer`
 *  registry: if a renderer is registered, `renderPdf()` returns a
 *  Buffer of the PDF; otherwise it returns the printable HTML and
 *  the caller delegates to the browser. This keeps the dependency
 *  optional and makes deploys under tight infra constraints work.
 */

import { renderTemplate } from "@gutu-plugin/template-core";

export interface PrintToPdfArgs {
  /** Pre-rendered HTML (typically from `print-format.renderPrintFormat()`). */
  html: string;
  /** Force a paper size (overrides any @page in the template). */
  paperSize?: "A4" | "A5" | "Letter" | "Legal" | "Thermal";
  orientation?: "portrait" | "landscape";
  /** Margins in mm. */
  marginMm?: number;
  /** Auto-trigger window.print() on load. */
  autoPrint?: boolean;
}

const PAGE_SIZES: Record<string, string> = {
  A4: "210mm 297mm",
  A5: "148mm 210mm",
  Letter: "8.5in 11in",
  Legal: "8.5in 14in",
  Thermal: "80mm 297mm",
};

export function buildPrintableHtml(args: PrintToPdfArgs): string {
  const size = PAGE_SIZES[args.paperSize ?? "A4"] ?? PAGE_SIZES.A4;
  const orientation = args.orientation ?? "portrait";
  const margin = args.marginMm ?? 18;
  const printScript = args.autoPrint !== false
    ? `<script>window.addEventListener('load', () => { setTimeout(() => window.print(), 200); });</script>`
    : "";
  const css = `
    @page {
      size: ${size} ${orientation};
      margin: ${margin}mm;
    }
    @media print {
      .no-print { display: none !important; }
    }
    html, body { background: #fff; color: #111; }
  `;
  // The incoming html may already contain a <!doctype>+<html>+<head>.
  // We merge by injecting our @page CSS + auto-print script before
  // </head>, or wrap if it's a fragment.
  if (/<\/head>/i.test(args.html)) {
    return args.html.replace(
      /<\/head>/i,
      `<style>${css}</style>${printScript}</head>`,
    );
  }
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>Print</title>
<style>${css}</style>
${printScript}
</head><body>${args.html}</body></html>`;
}

/* ----------------------------- Optional PDF adapter ---------------------- */

export type PdfRenderer = (html: string, options: PrintToPdfArgs) => Promise<Uint8Array>;

let registered: PdfRenderer | null = null;

/** Plug in a real PDF renderer (puppeteer / playwright / wkhtmltopdf).
 *  Once registered, `renderPdf()` returns the PDF bytes. */
export function registerPdfRenderer(renderer: PdfRenderer): void {
  registered = renderer;
}

export interface RenderPdfResult {
  kind: "pdf" | "html";
  body: Uint8Array | string;
  contentType: string;
  filename: string;
}

export async function renderPdf(
  args: PrintToPdfArgs & { filename?: string },
): Promise<RenderPdfResult> {
  if (registered) {
    const bytes = await registered(args.html, args);
    return {
      kind: "pdf",
      body: bytes,
      contentType: "application/pdf",
      filename: args.filename ?? "document.pdf",
    };
  }
  return {
    kind: "html",
    body: buildPrintableHtml(args),
    contentType: "text/html; charset=utf-8",
    filename: args.filename ?? "document.html",
  };
}

/** Convenience: render a Jinja-like template and produce printable HTML. */
export async function renderTemplateToPrintable(args: {
  template: string;
  context: Record<string, unknown>;
  paperSize?: PrintToPdfArgs["paperSize"];
  orientation?: PrintToPdfArgs["orientation"];
  marginMm?: number;
}): Promise<RenderPdfResult> {
  const out = renderTemplate(args.template, args.context, {});
  return renderPdf({
    html: out.output,
    paperSize: args.paperSize,
    orientation: args.orientation,
    marginMm: args.marginMm,
  });
}
