/* eslint-disable @typescript-eslint/no-explicit-any, max-lines */
import { Prisma, type PrismaClient } from "@prisma/client";
import { assertPrivateOwner, isPrivateMaintenance, isCredentialLookup, currentPrivateUserId, withPrivateUser, isPrivateMigration } from "./access";
import { cipherColumn, decodePrivateRow, encodePrivatePatch, encryptedModels, lookupToken, modelDefinitions, newPrivateId, ownerField, recordOwner, protectedField, protectedFields, storageUsageToken, isPublicDefinition } from "./modelCodec";

type Row = Record<string, any>;
const delegateName = (model: string) => model[0].toLowerCase() + model.slice(1);
const list = (value: any): any[] => Array.isArray(value) ? value : [value];
const relation = (model: string, name: string) => modelDefinitions.get(model)?.fields.find(field => field.name === name && field.kind === "object");

function readsEncryptedTree(model: string, args: Row): boolean {
  if (encryptedModels.has(model) || hasPrivatePredicate(model, args.where)) return true;
  return Object.entries(args.select ?? args.include ?? {}).some(([field, selection]) => {
    const linked = relation(model, field);
    return Boolean(linked && selection && readsEncryptedTree(linked.type, selection === true ? {} : selection as Row));
  });
}

function writesEncryptedTree(model: string, data: Row): boolean {
  return Object.entries(data ?? {}).some(([field, nested]) => {
    const linked = relation(model, field);
    return Boolean(linked && nested && (encryptedModels.has(linked.type) || list(nested.create ?? nested.createMany?.data ?? []).some(item => writesEncryptedTree(linked.type, item))));
  });
}

function flattenedWhere(model: string, where: Row = {}): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(where)) {
    if (!modelDefinitions.get(model)?.fields.some(field => field.name === key) && !["AND", "OR", "NOT"].includes(key) && value && typeof value === "object") Object.assign(result, value);
    else result[key] = value;
  }
  return result;
}

function hasPrivatePredicate(model: string, where: Row = {}): boolean {
  return Object.entries(flattenedWhere(model, where)).some(([key, value]) => protectedField(model, key) ||
    (["AND", "OR", "NOT"].includes(key) && list(value).some(item => hasPrivatePredicate(model, item))) ||
    (relation(model, key) && value && Object.values(value).some(item => item && typeof item === "object" && hasPrivatePredicate(relation(model, key)!.type, item as Row))));
}

// Every removed predicate is re-evaluated after ownership authorization. NOT
// branches containing private predicates are removed as a whole to keep a SQL
// superset, rather than accidentally turning NOT {} into an empty candidate set.
function sqlWhere(model: string, where: Row = {}): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(flattenedWhere(model, where))) {
    if (value === undefined) continue;
    if (["AND", "OR", "NOT"].includes(key)) {
      if (key === "NOT" && list(value).some(item => hasPrivatePredicate(model, item))) continue;
      const children = list(value).map(item => sqlWhere(model, item));
      // Prisma treats OR with empty objects differently from mathematical OR.
      // A stripped child means every SQL candidate may match that branch.
      if (key === "OR" && children.some(item => !Object.keys(item).length)) continue;
      if (key === "AND") {
        const retained = children.filter(item => Object.keys(item).length);
        if (retained.length) result.AND = [...(result.AND ?? []), ...retained];
      } else result[key] = children;
      continue;
    }
    const linked = relation(model, key);
    if (linked) {
      // Negated relation predicates must remain a SQL superset until decrypted.
      if (hasPrivatePredicate(model, { [key]: value })) continue;
      result[key] = Object.fromEntries(Object.entries(value ?? {}).map(([operator, nested]) => [operator, nested && typeof nested === "object" ? sqlWhere(linked.type, nested as Row) : nested]));
      continue;
    }
    const field = protectedField(model, key);
    if (!field) { result[key] = value; continue; }
    if (field.type !== "String" || field.isList) continue;
    if (value === null || typeof value === "string") {
      if (["ReadinessPack", "Requirement"].includes(model)) (result.AND ??= []).push({ OR: [{ [key]: value }, { [key]: lookupToken(model, key, value) }] });
      else result[key] = lookupToken(model, key, value);
      continue;
    }
    if (!value || typeof value !== "object" || value.mode === "insensitive" || ["ReadinessPack", "Requirement"].includes(model)) continue;
    const exact: Row = {};
    for (const [operator, input] of Object.entries(value)) {
      if (operator === "equals") exact.equals = lookupToken(model, key, input);
      else if (["in", "notIn"].includes(operator)) exact[operator] = list(input).map(item => lookupToken(model, key, item));
      else if (operator === "not" && (input === null || typeof input === "string")) exact.not = lookupToken(model, key, input);
    }
    if (Object.keys(exact).length) result[key] = exact;
  }
  return result;
}

function compare(a: any, b: any) {
  const left = a instanceof Date ? a.getTime() : a, right = b instanceof Date ? b.getTime() : b;
  return left === right ? 0 : left === null || left === undefined ? 1 : right === null || right === undefined ? -1 : left < right ? -1 : 1;
}
function equal(a: any, b: any) {
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  return a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : a === b;
}

function scalarMatches(actual: any, filter: any): boolean {
  if (filter === undefined) return true;
  if (filter === null || typeof filter !== "object" || filter instanceof Date || Array.isArray(filter)) return equal(actual, filter);
  if ("path" in filter) {
    let nested = actual;
    for (const key of filter.path) nested = nested?.[key];
    return scalarMatches(nested, Object.fromEntries(Object.entries(filter).filter(([key]) => key !== "path")));
  }
  if ("equals" in filter && [Prisma.DbNull, Prisma.AnyNull, Prisma.JsonNull].includes(filter.equals)) return actual === null || actual === undefined;
  let value = actual;
  const normalized = (input: any) => filter.mode === "insensitive" && typeof input === "string" ? input.toLowerCase() : input;
  value = normalized(value);
  return Object.entries(filter).every(([operator, raw]) => {
    const expected = normalized(raw);
    if (operator === "mode") return true;
    if (operator === "equals") return equal(value, expected);
    if (operator === "not") return actual === null && raw !== null ? false : !scalarMatches(actual, raw);
    if (operator === "in") return list(raw).some(item => equal(value, normalized(item)));
    if (operator === "notIn") return value !== null && !list(raw).some(item => equal(value, normalized(item)));
    if (operator === "contains") return typeof value === "string" && value.includes(expected);
    if (operator === "startsWith") return typeof value === "string" && value.startsWith(expected);
    if (operator === "endsWith") return typeof value === "string" && value.endsWith(expected);
    if (["lt", "lte", "gt", "gte"].includes(operator)) {
      if (value === null || value === undefined) return false;
      const order = compare(value, actual instanceof Date ? new Date(raw as string) : expected);
      return operator === "lt" ? order < 0 : operator === "lte" ? order <= 0 : operator === "gt" ? order > 0 : order >= 0;
    }
    if (operator === "has") return Array.isArray(value) && value.some(item => equal(item, raw));
    if (operator === "hasSome") return Array.isArray(value) && list(raw).some(item => value.includes(item));
    if (operator === "hasEvery") return Array.isArray(value) && list(raw).every(item => value.includes(item));
    if (operator === "isEmpty") return Array.isArray(value) && (value.length === 0) === raw;
    throw new Error("PRIVATE_FILTER_UNSUPPORTED");
  });
}

function matches(model: string, row: Row, where: Row = {}): boolean {
  return Object.entries(flattenedWhere(model, where)).every(([key, value]) => {
    if (key === "AND") return list(value).every(item => matches(model, row, item));
    if (key === "OR") return list(value).some(item => matches(model, row, item));
    if (key === "NOT") return !list(value).some(item => matches(model, row, item));
    const linked = relation(model, key);
    if (linked) return Object.entries(value ?? {}).every(([operator, nested]) => {
      const items = Array.isArray(row[key]) ? row[key] : row[key] ? [row[key]] : [];
      if (operator === "some" || operator === "is") return items.some(item => matches(linked.type, item, nested as Row));
      if (operator === "none" || operator === "isNot") return !items.some(item => matches(linked.type, item, nested as Row));
      if (operator === "every") return items.every(item => matches(linked.type, item, nested as Row));
      throw new Error("PRIVATE_RELATION_FILTER_UNSUPPORTED");
    });
    return scalarMatches(row[key], value);
  });
}

function orderRows(rows: Row[], orderBy: any) {
  if (!orderBy) return rows;
  return rows.sort((left, right) => {
    for (const clause of list(orderBy)) for (const [field, direction] of Object.entries(clause)) {
      if (typeof direction !== "string") throw new Error("PRIVATE_SORT_UNSUPPORTED");
      const order = compare(left[field], right[field]);
      if (order) return direction === "desc" ? -order : order;
    }
    return 0;
  });
}

function selectedRelations(model: string, args: Row, where: Row = {}): Row {
  const selected: Row = {};
  for (const [field, value] of Object.entries(args.include ?? args.select ?? {})) if (value && relation(model, field)) selected[field] = value === true ? {} : value;
  for (const [field, filter] of Object.entries(where)) {
    if (["AND", "OR", "NOT"].includes(field)) {
      for (const child of list(filter)) Object.assign(selected, selectedRelations(model, args, child));
    } else if (relation(model, field)) selected[field] ??= {};
  }
  return selected;
}

function readArgs(model: string, args: Row): Row {
  const relations = selectedRelations(model, args, flattenedWhere(model, args.where));
  const include = Object.fromEntries(Object.entries(relations).map(([field, nested]) => {
    const linked = relation(model, field)!;
    const child = readArgs(linked.type, nested);
    if (!linked.isList) delete child.where;
    return [field, child];
  }));
  // All candidate scalar fields are loaded for predicates. Only fields needed
  // for the requested projection/predicates/order are decrypted below.
  return { where: sqlWhere(model, args.where), ...(Object.keys(include).length ? { include } : {}) };
}

function project(model: string, row: Row, args: Row): Row {
  const result: Row = {};
  for (const [field, value] of Object.entries(row)) {
    if (field.startsWith("private_") || ["legacyPrivateMetadata", "cataloguePrivacyVersion", "storageUsageKey"].includes(field)) continue;
    const linked = relation(model, field);
    const selection = (args.select ?? args.include ?? {})[field];
    if (args.select && !args.select[field]) continue;
    if (linked) {
      if (!selection) continue;
      result[field] = value;
    } else result[field] = value;
  }
  return result;
}

function finishRows(model: string, rawRows: Row[], args: Row): Row[] {
  const relations = selectedRelations(model, args, flattenedWhere(model, args.where));
  const exactOperationalRead = !["ReadinessPack", "Requirement"].includes(model) && args.select && Object.entries(args.select).every(([field, selected]) => !selected || !protectedField(model, field)) &&
    Object.entries(flattenedWhere(model, args.where)).every(([field, value]) => !relation(model, field) && !["AND", "OR", "NOT"].includes(field) &&
      (!protectedField(model, field) || protectedField(model, field)?.type === "String" && !protectedField(model, field)?.isList && (typeof value === "string" || value === null))) &&
    list(args.orderBy ?? []).every(clause => Object.keys(clause).every(field => !protectedField(model, field)));
  const effectiveWhere = exactOperationalRead ? sqlWhere(model, args.where) : args.where;
  const needed = args.select ? new Set<string>([...Object.keys(args.select), ...(exactOperationalRead ? [] : Object.keys(flattenedWhere(model, args.where))), ...list(args.orderBy ?? []).flatMap(clause => Object.keys(clause))]) : undefined;
  // Boolean branches may name additional private predicate fields.
  const addNeeded = (where: Row) => { for (const [key, value] of Object.entries(where ?? {})) if (["AND", "OR", "NOT"].includes(key)) list(value).forEach(addNeeded); else needed?.add(key); };
  if (!exactOperationalRead) addNeeded(args.where);
  let rows = rawRows.map(stored => {
    const linkedMembership = model === "TrustMember" && stored.memberUserId === currentPrivateUserId() && stored.status === "ACTIVE";
    const row = linkedMembership
      ? withPrivateUser(stored.ownerUserId, () => decodePrivateRow(model, stored, needed))
      : decodePrivateRow(model, stored, needed);
    for (const [field, nested] of Object.entries(relations)) {
      const linked = relation(model, field)!;
      const value = stored[field];
      const readNested = () => Array.isArray(value) ? finishRows(linked.type, value, nested) : value ? finishRows(linked.type, [value], nested)[0] ?? null : null;
      if (linkedMembership && field === "owner") {
        if (!nested.select || Object.entries(nested.select).some(([key, enabled]) => enabled && !["id", "name", "email"].includes(key))) throw new Error("PRIVATE_SHARED_PROFILE_PROJECTION_REJECTED");
        row[field] = withPrivateUser(stored.ownerUserId, readNested);
      } else row[field] = readNested();
    }
    return row;
  }).filter(row => matches(model, row, effectiveWhere));
  rows = orderRows(rows, args.orderBy);
  if (args.cursor) {
    const index = rows.findIndex(row => matches(model, row, args.cursor));
    rows = index < 0 ? [] : rows.slice(index);
  }
  if (args.distinct) {
    const seen = new Set<string>();
    rows = rows.filter(row => { const key = JSON.stringify(list(args.distinct).map(field => row[field])); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  if (args.skip) rows = rows.slice(args.skip);
  if (typeof args.take === "number") rows = args.take < 0 ? rows.slice(args.take) : rows.slice(0, args.take);
  return rows.map(row => project(model, row, args));
}

function credentialRead(model: string, original: any, operation: string, args: Row) {
  const allowed: Record<string, string[]> = {
    User: ["id", "passwordHash", "pinHash", "pinAttemptCount", "pinLockedUntil", "authVersion"],
    SignupVerification: ["id", "passwordHash", "otpHash", "expiresAt", "attemptCount", "updatedAt"],
    ExternalIdentity: ["id", "userId", "provider"],
    TrustMember: ["id", "ownerUserId", "status", "inviteExpiresAt", "invitePinHash", "pinAttemptCount", "pinLockedUntil", "accessType"],
  };
  if (!allowed[model] || !["findUnique", "findFirst", "findUniqueOrThrow", "findFirstOrThrow"].includes(operation) || !args.select || args.include) throw new Error("PRIVATE_CREDENTIAL_PROJECTION_REQUIRED");
  if (Object.entries(args.select).some(([field, enabled]) => enabled && !allowed[model].includes(field))) throw new Error("PRIVATE_CREDENTIAL_PROJECTION_REJECTED");
  // Only exact indexed identity lookup is allowed before authentication. No
  // arbitrary OR, substring, range queries or private predicate decryption.
  const where = flattenedWhere(model, args.where);
  const permitted = model === "User" ? ["id", "email"] : model === "SignupVerification" ? ["id", "email"] : model === "TrustMember" ? ["inviteTokenHash"] : ["provider", "providerAccountId"];
  if (!Object.keys(where).length || Object.entries(where).some(([key, value]) => !permitted.includes(key) || typeof value !== "string")) throw new Error("PRIVATE_CREDENTIAL_LOOKUP_REJECTED");
  const query = { where: sqlWhere(model, args.where), select: args.select };
  return original[operation.endsWith("OrThrow") ? "findFirstOrThrow" : "findFirst"](query);
}

async function assertRelatedOwners(raw: any, model: string, data: Row, ownerId: string) {
  if (!ownerId) return;
  for (const field of modelDefinitions.get(model)?.fields.filter(item => item.kind === "object" && item.relationFromFields?.length === 1) ?? []) {
    const id = data[field.relationFromFields![0]] ?? data[field.name]?.connect?.id;
    if (!id) continue;
    if (field.type === "User") {
      if (model !== "TrustMember" && id !== ownerId) throw new Error("PRIVATE_RELATION_OWNERSHIP_MISMATCH");
      continue;
    }
    const ownerKey = ownerField(field.type);
    if (!modelDefinitions.get(field.type)?.fields.some(item => item.name === ownerKey)) continue;
    const parent = await raw[delegateName(field.type)].findUnique({ where: { id }, select: { [ownerKey]: true } });
    if (!parent || parent[ownerKey] !== ownerId) throw new Error("PRIVATE_RELATION_OWNERSHIP_MISMATCH");
  }
}

async function prepareCreate(raw: any, model: string, data: Row, inheritedOwner?: string): Promise<Row> {
  let result = { ...data };
  if (modelDefinitions.get(model)?.fields.some(field => field.name === "id" && field.isId)) result.id ??= newPrivateId();
  let ownerId = result[ownerField(model)] ?? result.user?.connect?.id ?? inheritedOwner;
  if (model === "Requirement") {
    if (!ownerId) {
      const parent = await raw.readinessPack.findUnique({ where: { id: result.packId }, select: { createdBy: true } });
      if (!parent) notFound();
      ownerId = parent.createdBy;
    }
    result.privacyOwnerId = ownerId;
  }
  if (model === "DocumentFile") {
    if (!ownerId) {
      const parent = await raw.document.findUnique({ where: { id: result.documentId }, select: { id: true, ownerProfileId: true } });
      if (!parent) notFound();
      ownerId = recordOwner("Document", parent);
    }
    result.privacyOwnerId = ownerId;
  }
  await assertRelatedOwners(raw, model, data, ownerId);
  if (["Document", "DocumentFile"].includes(model)) result.storageUsageKey = storageUsageToken(ownerId, data.storageKey || data.path);
  if (encryptedModels.has(model) && !isPublicDefinition(model, result)) result = encodePrivatePatch(model, { id: result.id, userId: ownerId }, result, true);
  for (const field of modelDefinitions.get(model)?.fields.filter(item => item.kind === "object") ?? []) {
    const nested = result[field.name];
    if (!nested || typeof nested !== "object") continue;
    const owner = model === "User" ? result.id : ownerId;
    if (nested.create) {
      const created = await Promise.all(list(nested.create).map(item => prepareCreate(raw, field.type, item, owner)));
      result[field.name] = { ...nested, create: Array.isArray(nested.create) ? created : created[0] };
    }
    if (nested.createMany?.data) result[field.name] = { ...result[field.name], createMany: { ...nested.createMany, data: await Promise.all(list(nested.createMany.data).map(item => prepareCreate(raw, field.type, item, owner))) } };
  }
  return result;
}

function notFound(): never { throw new Prisma.PrismaClientKnownRequestError("Record not found.", { code: "P2025", clientVersion: Prisma.prismaVersion.client }); }

// Query-only facade: no automatic decryption without an explicit user or
// offline-migration capability. Ciphertext columns never escape the facade.
export function encryptedClient(raw: any, inTransaction = false): PrismaClient {
  const cached = new Map<string, any>();
  return new Proxy(raw, {
    get(target, property) {
      if (property === "$transaction") return (work: any, options?: any) => {
        if (typeof work !== "function") throw new Error("PRIVATE_TRANSACTION_CALLBACK_REQUIRED");
        return target.$transaction((tx: any) => work(encryptedClient(tx, true)), options);
      };
      const model = [...modelDefinitions.keys()].find(name => delegateName(name) === property);
      if (!model) return typeof target[property] === "function" ? target[property].bind(target) : target[property];
      if (cached.has(model)) return cached.get(model);
      const delegate = new Proxy(target[property], {
        get(original, operation) {
          if (typeof operation !== "string" || typeof original[operation] !== "function") return original[operation];
          return async (args: Row = {}) => {
            if (["ReadinessPack", "Requirement"].includes(model) && !isPrivateMigration() && !["create", "createMany", "createManyAndReturn"].includes(operation)) {
              const userId = currentPrivateUserId();
              args = { ...args, where: { AND: [args.where ?? {}, { [ownerField(model)]: { in: userId ? ["seed", userId] : ["seed"] } }] } };
            }
            if (!encryptedModels.has(model) && !readsEncryptedTree(model, args) && !writesEncryptedTree(model, args.data)) return original[operation](args);
            if (["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "count"].includes(operation)) {
              if (isCredentialLookup()) return credentialRead(model, original, operation, args);
              if (operation === "count" && !hasPrivatePredicate(model, args.where)) return original.count(args);
              const rows = finishRows(model, await original.findMany(readArgs(model, args)), args);
              if (operation === "count") return rows.length;
              if (operation === "findMany") return rows;
              return rows[0] ?? (operation.endsWith("OrThrow") ? notFound() : null);
            }
            if (["aggregate", "groupBy"].includes(operation)) throw new Error("PRIVATE_AGGREGATION_REQUIRES_AUTHORIZED_APPLICATION_PROCESSING");
            if (!inTransaction) return target.$transaction((tx: any) => (encryptedClient(tx, true) as any)[property][operation](args));
            if (operation === "create" || operation === "createMany" || operation === "createManyAndReturn") {
              const data = await Promise.all(list(args.data).map(item => prepareCreate(target, model, item)));
              const saved = await original[operation]({ ...args, select: undefined, ...(args.select || args.include ? { include: readArgs(model, { select: args.select, include: args.include }).include } : {}), data: operation === "create" ? data[0] : data });
              if (operation === "createMany") return saved;
              const result = finishRows(model, list(saved), { select: args.select, include: args.include });
              return operation === "create" ? result[0] : result;
            }
            if (operation === "upsert") {
              // Serialize this upsert identity before lookup, including across
              // backend processes. Only a keyed digest reaches database SQL.
              const token = lookupToken(model, "upsert", args.where);
              await target.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${token}, 0))`;
              const found = await (encryptedClient(target, true) as any)[property].findUnique({ where: args.where, select: { id: true, [ownerField(model)]: true } });
              return (encryptedClient(target, true) as any)[property][found ? "update" : "create"]({ ...(found ? { where: { id: found.id } } : {}), data: found ? args.update : args.create, select: args.select, include: args.include });
            }
            if (["update", "updateMany", "updateManyAndReturn", "delete", "deleteMany"].includes(operation)) {
              if (!encryptedModels.has(model)) {
                // Existing application nested writes create relation rows. Any
                // unsupported nested mutation still hits SQL plaintext guards.
                if (operation !== "update" || !args.where?.id) throw new Error("PRIVATE_NESTED_MUTATION_UNSUPPORTED");
                const prepared = await prepareCreate(target, model, { ...args.data, id: args.where.id });
                const include = readArgs(model, { select: args.select, include: args.include }).include;
                const saved = await original.update({ where: args.where, data: prepared, ...(include ? { include } : {}) });
                return finishRows(model, [saved], { select: args.select, include: args.include })[0];
              }
              if (operation === "deleteMany" && isPrivateMaintenance() && !hasPrivatePredicate(model, args.where)) return original.deleteMany(args);
              const stored = await original.findMany(readArgs(model, { where: args.where, include: args.include }));
              const matching = finishRows(model, stored, { where: args.where, select: {
                id: true, [ownerField(model)]: true,
                ...(["Document", "DocumentFile"].includes(model) && ("storageKey" in (args.data ?? {}) || "path" in (args.data ?? {})) ? { storageKey: true, ...(model === "Document" ? { path: true } : {}) } : {}),
              } });
              if (!["updateMany", "updateManyAndReturn", "deleteMany"].includes(operation) && !matching.length) notFound();
              let count = 0;
              const changed: Row[] = [];
              for (const row of matching) {
                const ownerId = recordOwner(model, row);
                if (!isPublicDefinition(model, row)) assertPrivateOwner(ownerId);
                if (args.data?.[ownerField(model)] !== undefined && args.data[ownerField(model)] !== ownerId) throw new Error("PRIVATE_OWNERSHIP_IMMUTABLE");
                if (args.data?.user || args.data?.owner) throw new Error("PRIVATE_OWNERSHIP_IMMUTABLE");
                const observed = stored.find((item: Row) => item.id === row.id);
                const where: Row = { id: row.id, [ownerField(model)]: ownerId, AND: [sqlWhere(model, args.where)] };
                // Protect predicate evaluation against concurrent changes.
                if (hasPrivatePredicate(model, args.where)) for (const field of protectedFields(model)) where[cipherColumn(field.name)] = observed[cipherColumn(field.name)];
                if (operation.startsWith("delete")) {
                  const deleted = await original.deleteMany({ where });
                  count += deleted.count;
                  if (deleted.count) changed.push(observed);
                } else {
                  const data = isPublicDefinition(model, row) ? { ...args.data } : encodePrivatePatch(model, { id: row.id, userId: ownerId }, args.data);
                  for (const field of modelDefinitions.get(model)?.fields.filter(item => item.kind === "object") ?? []) {
                    const nested = data[field.name];
                    if (nested?.create) {
                      const created = await Promise.all(list(nested.create).map(item => prepareCreate(target, field.type, item, ownerId)));
                      data[field.name] = { ...nested, create: Array.isArray(nested.create) ? created : created[0] };
                    }
                  }
                  await assertRelatedOwners(target, model, args.data, ownerId);
                  if (["Document", "DocumentFile"].includes(model) && ("storageKey" in args.data || "path" in args.data)) data.storageUsageKey = storageUsageToken(ownerId, (args.data.storageKey === undefined ? row.storageKey : args.data.storageKey) || (args.data.path === undefined ? row.path : args.data.path));
                  if (operation === "update") {
                    const include = readArgs(model, { select: args.select, include: args.include }).include;
                    changed.push(await original.update({ where, data, ...(include ? { include } : {}) }));
                    count++;
                  } else {
                    const updated = await original.updateMany({ where, data });
                    count += updated.count;
                    if (updated.count) changed.push(await original.findUnique({ ...readArgs(model, { select: args.select, include: args.include }), where: { id: row.id } }));
                  }
                }
              }
              if (operation.endsWith("Many")) return { count };
              const result = finishRows(model, changed, { select: args.select, include: args.include });
              return operation.endsWith("AndReturn") ? result : result[0] ?? notFound();
            }
            throw new Error("PRIVATE_PERSISTENCE_OPERATION_UNSUPPORTED");
          };
        },
      });
      cached.set(model, delegate);
      return delegate;
    },
  }) as PrismaClient;
}
