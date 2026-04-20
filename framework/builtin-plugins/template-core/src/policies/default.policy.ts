import { definePolicy } from "@platform/permissions";

export const templatePolicy = definePolicy({
  id: "template-core.default",
  rules: [
    {
      permission: "template.records.read",
      allowIf: ["role:admin", "role:operator"]
    },
    {
      permission: "template.records.version",
      allowIf: ["role:admin"],
      requireReason: true,
      audit: true
    }
  ]
});