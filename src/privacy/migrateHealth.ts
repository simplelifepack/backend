import { decodePrivateRow, encodePrivatePatch, maskedValue, protectedFields, cipherColumn, recordOwner, storageUsageToken, isPublicDefinition } from "./modelCodec";

export function migrateHealthRow(model: string, row: Record<string, unknown>) {
  if (isPublicDefinition(model, row)) return {};
  const missing: Record<string, unknown> = {};
  const patch: Record<string, unknown> = {};
  for (const field of protectedFields(model)) {
    const column = cipherColumn(field.name);
    if (row[column] === null || row[column] === undefined) missing[field.name] = row[field.name];
    else {
      // Authenticate every existing field, including during a dry-run.
      const value = decodePrivateRow(model, row, new Set([field.name]))[field.name];
      const masked = maskedValue(model, field, value, recordOwner(model, row));
      const isNullJson = field.type === "Json" && !field.isRequired && row[field.name] === null;
      if (!isNullJson && JSON.stringify(row[field.name]) !== JSON.stringify(masked)) patch[field.name] = masked;
    }
  }
  const result = { ...patch, ...encodePrivatePatch(model, { id: String(row.id), userId: recordOwner(model, row) }, missing) };
  if (["Document", "DocumentFile"].includes(model)) {
    const plaintext = { ...row, ...missing };
    for (const key of ["storageKey", "path"]) if (row[cipherColumn(key)]) plaintext[key] = decodePrivateRow(model, row, new Set([key]))[key];
    const key = storageUsageToken(recordOwner(model, row), plaintext.storageKey as string || plaintext.path as string);
    if (row.storageUsageKey !== key) result.storageUsageKey = key;
  }
  return result;
}
