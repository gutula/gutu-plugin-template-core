import { definePackage } from "@platform/kernel";

export default definePackage({
  id: "template-core",
  kind: "app",
  version: "0.1.0",
  displayName: "Template Core",
  description: "Reusable templates for content, messages, and workflows.",
  extends: [],
  dependsOn: ["auth-core","org-tenant-core","role-policy-core","audit-core"],
  optionalWith: [],
  conflictsWith: [],
  providesCapabilities: ["template.records"],
  requestedCapabilities: ["ui.register.admin", "api.rest.mount", "data.write.template"],
  ownsData: ["template.records"],
  extendsData: [],
  slotClaims: [],
  trustTier: "first-party",
  reviewTier: "R1",
  isolationProfile: "same-process-trusted",
  compatibility: {
    framework: "^0.1.0",
    runtime: "bun>=1.3.12",
    db: ["postgres", "sqlite"]
  }
});