/** Admin-shell UI contributions for template-core.
 *
 *  Two pages:
 *    - /settings/naming-series — document numbering patterns
 *    - /settings/print-formats — HTML print templates
 *
 *  Plus the PrintAction primitive that any record-detail page can drop in. */

import { defineAdminUi } from "@gutu-host/plugin-ui-contract";
import { NamingSeriesPage } from "./pages/NamingSeriesPage";
import { PrintFormatsPage } from "./pages/PrintFormatsPage";

export const adminUi = defineAdminUi({
  id: "template-core",
  pages: [
    {
      id: "template-core.naming-series",
      path: "/settings/naming-series",
      title: "Naming series",
      description: "Document numbering patterns with atomic counters.",
      Component: NamingSeriesPage,
      icon: "Hash",
    },
    {
      id: "template-core.print-formats",
      path: "/settings/print-formats",
      title: "Print formats",
      description: "HTML print templates with letter-head support.",
      Component: PrintFormatsPage,
      icon: "FileText",
    },
  ],
  navEntries: [
    {
      id: "template-core.nav.naming-series",
      label: "Naming series",
      icon: "Hash",
      path: "/settings/naming-series",
      section: "settings",
      order: 12,
    },
    {
      id: "template-core.nav.print-formats",
      label: "Print formats",
      icon: "FileText",
      path: "/settings/print-formats",
      section: "settings",
      order: 13,
    },
  ],
  commands: [
    {
      id: "template-core.cmd.naming-series",
      label: "Open Naming series",
      icon: "Hash",
      keywords: ["naming", "series", "counter", "numbering"],
      run: () => { window.location.hash = "/settings/naming-series"; },
    },
    {
      id: "template-core.cmd.print-formats",
      label: "Open Print formats",
      icon: "FileText",
      keywords: ["print", "format", "pdf", "template"],
      run: () => { window.location.hash = "/settings/print-formats"; },
    },
  ],
});

export { NamingSeriesPage } from "./pages/NamingSeriesPage";
export { PrintFormatsPage } from "./pages/PrintFormatsPage";
// PrintAction now lives in the shell's admin-primitives (it's a generic
// detail-page button). Re-export for any consumer importing from this
// plugin's barrel.
export { PrintAction } from "@/admin-primitives/PrintAction";
