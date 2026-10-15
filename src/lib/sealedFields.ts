// The canonical list of field names an admin-facing response must never
// contain, by Prisma model. Mirrors readiness-admin-console.html's #access
// "sealed list" exactly (six categories). Several of these models —
// HealthMember, HealthDocument, HealthMeasurement, HealthMedication,
// HealthFollowUp, HealthReminder, WealthRecord, WealthRecordAttachment —
// have NO admin DTO today (grep confirmed 13 Oct: existing admin code only
// ever does `.count()`/`.aggregate()` against them, or a `select` that
// already excludes every field listed here). They're registered anyway
// as documentation for the day someone adds a `findMany` without a
// `select` and needs to know what NOT to put in it.
//
// Two consumers, with different reliability:
//   - `pickDto()` — a call-site helper, safe and unconditionally useful:
//     forces whoever builds a DTO to write out the field list instead of
//     spreading a full Prisma row.
//   - `findSealedKeys()` — a manual-review aid ONLY, not wired into the
//     contract test. It matches by key NAME, and field names collide
//     constantly across unrelated models (User.name vs HealthMember.name,
//     HealthDocument.type vs HealthReminder.type, the KMS rotation
//     endpoint's own legitimate `keyId` vs Document.keyId) — running it
//     against real admin responses threw 7 false positives on the first
//     try, zero of them real leaks. The actual contract test
//     (dtoAllowlist.contract.test.ts) matches by seeded marker VALUE
//     instead, which has no such ambiguity; use `findSealedKeys` only as
//     a quick manual check on a DTO you're about to ship, and expect to
//     eyeball its output rather than trust it standalone.
//
// A field NOT listed here is assumed safe to show (ids, foreign keys,
// timestamps, statuses, counts, enums). Don't list structural fields —
// that would make the scanner flag normal responses and get disabled.
export const SEALED_FIELDS: Record<string, readonly string[]> = {
  // "Credentials and recovery: passwordHash, recoveryVerifier, refresh
  // tokens, OAuth tokens"
  User: ["passwordHash", "pinHash"],
  RefreshToken: ["tokenHash"],
  PasswordResetToken: ["tokenHash"],
  AccountChangeOtp: ["newPasswordHash", "newPinHash", "otpHash"],
  SignupVerification: ["passwordHash", "otpHash"],
  ExternalConnection: ["encryptedRefreshToken"],

  // "File bytes and previews: S3 objects; download and preview stay
  // owner-only" + "Document text and identifiers: rawText,
  // uniqueIdentifier, extractedKeyFields, titles". Document also carries
  // encryption plumbing (wrappedKey, encryptionIv, hashes, the on-disk
  // path) that's equally never admin-visible, even though the design
  // doc's one-line summary doesn't spell out every column. `keyId` is
  // deliberately NOT here: it's the master/envelope key's own rotation
  // identifier, shared across many documents, not a secret — the
  // pre-existing Security screen correctly groups and counts documents by
  // it (`GET /admin/v1/security`) for key-rotation posture monitoring.
  // That's the one real finding the first run of the contract test below
  // produced: seeding `keyId` as if it were secret key material (confused
  // with `wrappedKey`/`encryptionIv`, which actually are) flagged that
  // legitimate, unmodified route as a false "leak". Fixed here, in the
  // registry, not in the route.
  Document: [
    "title",
    "displayName",
    "uniqueIdentifier",
    "uniqueIdentifierHash",
    "extractedKeyFields",
    "rawText",
    "fields",
    "path",
    "storageKey",
    "storageBucket",
    "storageMimeType",
    "wrappedKey",
    "encryptionIv",
    "keyAlgorithm",
    "contentAlgorithm",
    "originalSha256",
    "encryptedSha256",
    "ciphertextHash",
    "userScopedDedupHash",
    "metadataIntegrityHash",
    "contentHash",
    "sourceChecksum",
    "driveFileId",
    "sourceMessageId",
    "sourceAttachmentId",
  ],

  // "Health records: conditions, allergies, measurements, medications,
  // policy numbers". No admin DTO reads these today — sealed in full
  // (every content field; only ids/fks/status/timestamps stay visible,
  // matching the one real reader, pipelines.routes.ts's failed-extraction
  // list, which already hand-picks exactly that set).
  HealthMember: [
    "name",
    "relation",
    "bloodGroup",
    "dateOfBirth",
    "conditions",
    "allergies",
    "emergencyContactName",
    "emergencyContactPhone",
    "primaryDoctor",
    "insuranceProvider",
    "insurancePolicyNumber",
  ],
  HealthDocument: ["provider", "doctor", "patientName", "patientDateOfBirth", "pendingExtraction"],
  HealthMeasurement: [
    "metricKey",
    "displayName",
    "originalName",
    "value",
    "secondaryValue",
    "unit",
    "context",
    "bodySite",
    "referenceMin",
    "referenceMax",
    "referenceText",
    "measuredAt",
  ],
  TrackedHealthMetric: ["metricKey", "displayName", "context", "bodySite"],
  HealthMedication: ["name", "dose", "frequency", "duration", "quantity", "whenToTake", "mealTiming", "repeatRunsOut"],
  HealthFollowUp: ["title", "explicitDate", "recommendedAfterValue", "recommendedAfterUnit", "dueDate", "sourceText"],
  HealthReminder: ["title", "type", "dueDate", "frequency", "recurrence"],

  // "Wealth records: details, notes, attachments, handoff content". No
  // admin DTO reads WealthRecord content today either (the Forms/doc-type
  // catalog work is the schema side, never the member's own records).
  WealthRecord: ["title", "details", "notes", "followUpDate", "followUpNote"],

  // "Trust-center content: what a member was given; only counts and
  // status show." The member's own identity (name/email/relation/status)
  // is intentionally NOT here — see adminTrust.service.ts's comment: a
  // trust member's identity is distinct from what they were granted, and
  // Users.tsx shows the former for abuse-response. Only the grant itself
  // is sealed.
  TrustMemberPermission: ["canView", "canDownload"],
};

/** Every (model, field) pair this registry protects, flattened once for the scanner's O(1) lookups. */
const SEALED_KEY_SET: Set<string> = new Set(Object.values(SEALED_FIELDS).flat());

/**
 * Recursively walks any JSON-shaped value (the kind `res.json()` sends) and
 * returns every key name encountered that matches a sealed field somewhere
 * in the registry — regardless of which model it came from, since a plain
 * object by the time it reaches an HTTP response has already lost its
 * Prisma model tag. A false positive (an unrelated field that happens to
 * share a sealed name, e.g. some other model's own unrelated `title`) is
 * possible by construction; see dtoAllowlist.contract.test.ts for why that
 * tradeoff is the right one for a build-breaking safety net.
 */
export function findSealedKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  const seen = new Set<unknown>();

  function walk(node: unknown, nodePath: string) {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return; // guards against circular references
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${nodePath}[${i}]`));
      return;
    }

    for (const [key, childValue] of Object.entries(node as Record<string, unknown>)) {
      const childPath = `${nodePath}.${key}`;
      if (SEALED_KEY_SET.has(key)) hits.push(childPath);
      walk(childValue, childPath);
    }
  }

  walk(value, path);
  return hits;
}

/**
 * The DTO allowlist helper: picks exactly the given keys off a row, nothing
 * else. Forces whoever builds a DTO to write out the field list by hand
 * instead of spreading `...row` and hoping nothing sealed rides along.
 * Doesn't itself stop a caller from allowlisting a sealed field by
 * mistake — that's the contract test's job — but it does make "I only
 * copied what I meant to" the natural way to write a DTO rather than the
 * exception.
 */
export function pickDto<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) result[key] = row[key];
  return result;
}
