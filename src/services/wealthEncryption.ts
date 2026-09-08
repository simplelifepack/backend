import type { Prisma } from '@prisma/client';
import { decryptJson, decryptString, encryptJson, encryptString } from '../utils/documentEncryption';
export function encryptWealthFields(record: { title: string; details: Prisma.JsonValue | Prisma.InputJsonValue; notes?: string | null; followUpNote?: string | null }) {
  return { title: encryptString(record.title)!, details: encryptJson(record.details), notes: encryptString(record.notes), followUpNote: encryptString(record.followUpNote) };
}
export function decryptWealthRecord<T extends { title: string; details: Prisma.JsonValue; notes: string | null; followUpNote: string | null }>(record: T): T {
  return { ...record, title: decryptString(record.title)!, details: decryptJson<Prisma.JsonValue>(record.details, {}), notes: decryptString(record.notes), followUpNote: decryptString(record.followUpNote) };
}
