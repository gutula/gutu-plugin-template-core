import { normalizeActionInput } from "@platform/schema";

export type DomainActionInput = {
  id: string;
  tenantId: string;
  reason?: string | undefined;
};

export function versionTemplateRecord(input: DomainActionInput): { ok: true; nextStatus: "active" | "inactive" } {
  normalizeActionInput(input);
  const nextStatus = "inactive" as const;
  return { ok: true, nextStatus };
}