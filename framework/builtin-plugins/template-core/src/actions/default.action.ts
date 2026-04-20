import { defineAction } from "@platform/schema";
import { z } from "zod";
import { versionTemplateRecord } from "../services/main.service";

export const versionTemplateRecordAction = defineAction({
  id: "template.records.version",
  input: z.object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    reason: z.string().min(3).optional()
  }),
  output: z.object({
    ok: z.literal(true),
    nextStatus: z.enum(["active", "inactive"])
  }),
  permission: "template.records.version",
  idempotent: true,
  audit: true,
  handler: ({ input }) => versionTemplateRecord(input)
});