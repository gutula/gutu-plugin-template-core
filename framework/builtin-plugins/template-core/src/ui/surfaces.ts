import { defineUiSurface } from "@platform/ui-shell";
import { TemplateCoreAdminPage } from "./admin/main.page";

export const uiSurface = defineUiSurface({
  embeddedPages: [
    {
      shell: "admin",
      route: "/admin/template-core",
      component: TemplateCoreAdminPage,
      permission: "template.records.read"
    }
  ],
  widgets: []
});