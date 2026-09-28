import SwaggerParser from "@apidevtools/swagger-parser";
import { expectedOperations, openApiDocument } from "./openapi";

const mountedOperations = [
  "GET /health",
  "POST /auth/signup/request-otp",
  "POST /auth/signup",
  "POST /auth/login",
  "POST /auth/google",
  "POST /auth/refresh",
  "POST /auth/logout",
  "POST /auth/logout-all",
  "POST /auth/account/change-email/request",
  "POST /auth/account/change-email/verify",
  "POST /auth/account/change-password/request",
  "POST /auth/account/change-password/verify",
  "POST /auth/forgot-password",
  "POST /auth/forgot-password/otp",
  "POST /auth/reset-password",
  "POST /auth/reset-password/otp",
  "GET /auth/me",
  "GET /api/bootstrap/usage",
  "GET /api/bootstrap",
  "GET /documents/encryption-key",
  "POST /documents/analyze",
  "POST /documents",
  "POST /documents/upload",
  "GET /documents",
  "POST /documents/bulk-download",
  "POST /documents/bulk-delete",
  "POST /documents/{id}/pages",
  "PATCH /documents/{id}/pages/order",
  "PATCH /documents/{id}/pages/{pageId}",
  "DELETE /documents/{id}/pages/{pageId}",
  "GET /documents/{id}/pages/{pageId}/download",
  "GET /documents/{id}/pages/{pageId}/preview",
  "GET /documents/{id}",
  "DELETE /documents/{id}",
  "GET /documents/{id}/download",
  "GET /documents/{id}/preview",
  "GET /packs/search",
  "POST /packs/search-or-generate",
  "GET /packs/{slug}",
  "POST /packs/{slug}/requirements/{requirementId}/assignment",
  "DELETE /packs/{slug}/requirements/{requirementId}/assignment",
  "GET /packs",
  "GET /packages/search",
  "POST /packages/search-or-generate",
  "GET /packages/{slug}",
  "POST /packages/{slug}/requirements/{requirementId}/assignment",
  "DELETE /packages/{slug}/requirements/{requirementId}/assignment",
  "GET /packages",
  "GET /api/packages/search",
  "POST /api/packages/search-or-generate",
  "GET /api/packages/{slug}",
  "POST /api/packages/{slug}/requirements/{requirementId}/assignment",
  "DELETE /api/packages/{slug}/requirements/{requirementId}/assignment",
  "GET /api/packages",
  "POST /admin/readiness/seed",
  "GET /api/integrations/gmail/callback",
  "GET /api/integrations/gmail/status",
  "POST /api/integrations/gmail/authorize",
  "POST /api/integrations/gmail/scan",
  "GET /api/integrations/gmail/candidates",
  "POST /api/integrations/gmail/candidates/{id}/dismiss",
  "POST /api/integrations/gmail/import",
  "DELETE /api/integrations/gmail",
  "GET /api/integrations/drive/callback",
  "GET /api/integrations/drive/status",
  "POST /api/integrations/drive/authorize",
  "POST /api/integrations/drive/scan",
  "DELETE /api/integrations/drive",
  "GET /api/trust/invitations/{token}",
  "POST /api/trust/invitations/{token}/accept",
  "POST /api/trust/invitations/{token}/reject",
  "GET /api/trust",
  "POST /api/trust/family-members",
  "POST /api/trust/members",
  "PATCH /api/trust/members/{id}",
  "POST /api/trust/members/{id}/resend-invitation",
  "POST /api/trust/members/{id}/reset-pin",
  "DELETE /api/trust/members/{id}",
  "POST /api/trust/connections/{id}/leave",
  "GET /api/wealth/form/categories",
  "GET /api/wealth/form/categories/{categoryCode}/subtypes",
  "GET /api/wealth/form/categories/{categoryCode}/subtypes/{subtypeCode}/schema",
  "POST /api/wealth/form/records",
  "GET /api/wealth/records",
  "POST /api/wealth/records",
  "PATCH /api/wealth/records/{recordId}",
  "DELETE /api/wealth/records/{recordId}",
  "GET /api/wealth/handoff/summary",
  "POST /api/wealth/handoff/send",
  "GET /api/health/members",
  "POST /api/health/members",
  "PATCH /api/health/members/{memberId}",
  "DELETE /api/health/members/{memberId}",
  "GET /api/health/members/{memberId}/overview",
  "GET /api/health/members/{memberId}/records",
  "POST /api/health/records",
  "GET /api/health/records/{recordId}",
  "PATCH /api/health/records/{recordId}",
  "DELETE /api/health/records/{recordId}",
  "POST /api/health/records/{recordId}/reprocess",
  "GET /api/health/members/{memberId}/measurements",
  "GET /api/health/members/{memberId}/tracked-metrics",
  "POST /api/health/members/{memberId}/tracked-metrics",
  "DELETE /api/health/members/{memberId}/tracked-metrics/{trackedId}",
  "GET /api/health/members/{memberId}/available-metrics",
  "GET /api/health/members/{memberId}/timeline",
  "POST /api/health/members/{memberId}/medications",
  "PATCH /api/health/medications/{medicationId}",
  "DELETE /api/health/medications/{medicationId}",
  "GET /api/health/reminders",
  "POST /api/health/reminders",
  "GET /api/notifications/config",
  "POST /api/notifications/status",
  "POST /api/notifications/subscriptions",
  "POST /api/notifications/subscriptions/disable",
  "POST /api/notifications/test",
  "POST /api/account/export",
  "GET /api/account/export/{jobId}",
  "GET /api/account/export/{jobId}/download",
  "POST /api/account/deletion",
  "GET /api/preferences",
  "PATCH /api/preferences",
  "POST /admin/notifications/send",
  "POST /admin/account/deletions/process",
].sort();

function diff(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function findEmptyEnums(value: unknown, path = "$", found: string[] = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => findEmptyEnums(item, `${path}[${index}]`, found));
    return found;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.enum) && record.enum.length === 0) found.push(`${path}.enum`);
  Object.entries(record).forEach(([key, item]) => findEmptyEnums(item, `${path}.${key}`, found));
  return found;
}

function schemasMissingExamples() {
  const schemas = openApiDocument.components.schemas as Record<string, { example?: unknown }>;
  return Object.entries(schemas).flatMap(([name, schema]) => (
    schema.example === undefined ? [name] : []
  ));
}

async function main() {
  await SwaggerParser.validate(openApiDocument as never);

  const missingFromOpenApi = diff(mountedOperations, expectedOperations);
  const extraInOpenApi = diff(expectedOperations, mountedOperations);
  const emptyEnums = findEmptyEnums(openApiDocument);
  const missingExamples = schemasMissingExamples();

  if (missingFromOpenApi.length || extraInOpenApi.length || emptyEnums.length || missingExamples.length) {
    throw new Error([
      "OpenAPI coverage mismatch.",
      missingFromOpenApi.length ? `Missing from OpenAPI:\n${missingFromOpenApi.join("\n")}` : "",
      extraInOpenApi.length ? `Extra in OpenAPI:\n${extraInOpenApi.join("\n")}` : "",
      emptyEnums.length ? `Empty enums:\n${emptyEnums.join("\n")}` : "",
      missingExamples.length ? `Schemas missing examples:\n${missingExamples.join("\n")}` : "",
    ].filter(Boolean).join("\n\n"));
  }

  console.log(`OpenAPI document is valid, covers ${expectedOperations.length} operations, has no empty enums, and all component schemas include examples.`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
