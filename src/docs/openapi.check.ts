import { mountedApiOperations } from "./mountedOperations";
import SwaggerParser from "@apidevtools/swagger-parser";
import { expectedOperations, openApiDocument } from "./openapi";

const mountedOperations = mountedApiOperations();

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
  const ids = Object.values(openApiDocument.paths).flatMap(path => Object.values(path).map(operation => operation.operationId));
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate OpenAPI operationId.");
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
