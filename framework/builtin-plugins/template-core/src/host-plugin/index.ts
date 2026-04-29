/** Host-plugin contribution for template-core.
 *
 *  Mounts at /api/<routes> via the shell's plugin loader. */
import type { HostPlugin } from "@gutu-host/plugin-contract";

import { namingSeriesRoutes } from "./routes/naming-series";
import { printFormatRoutes } from "./routes/print-formats";
import { printPdfRoutes } from "./routes/print-pdf";


export const hostPlugin: HostPlugin = {
  id: "template-core",
  version: "1.0.0",
  
  routes: [
    { mountPath: "/naming-series", router: namingSeriesRoutes },
    { mountPath: "/print-formats", router: printFormatRoutes },
    { mountPath: "/print", router: printPdfRoutes }
  ],
  resources: [
    "template.template",
  ],
};

// Re-export the lib API so other plugins can `import` from
// "@gutu-plugin/template-core".
export * from "./lib";
