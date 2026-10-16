import { jobFieldIsEncrypted, privateJobFields } from "./packageJob";

// Defense in depth. SQL constraints remain the authority, including for alternate
// clients, raw SQL, nested writes and bulk operations that bypass middleware.
export function assertPrivateWrite(model: string, operation: string, args: { data?: unknown; create?: unknown; update?: unknown }) {
  if (model === "CustomPackageGenerationJob" && args) {
    const check = (data: Record<string, unknown> | undefined) => {
      if (!data) return;
      for (const field of privateJobFields) {
        if (!(field in data) || data[field] === undefined) continue;
        const value = data[field];
        // Native String update operators are accepted only as a single set.
        const stored = value && typeof value === "object" && !Array.isArray(value) && "set" in value
          ? Object.keys(value).length === 1 ? (value as { set: unknown }).set : undefined
          : value;
        if (stored === undefined || !jobFieldIsEncrypted(field, stored)) throw new Error("PRIVATE_PLAINTEXT_WRITE_REJECTED");
      }
    };
    if (["create", "update", "updateMany", "createMany", "createManyAndReturn", "updateManyAndReturn"].includes(operation)) {
      for (const data of [args.data].flat()) check(data as Record<string, unknown>);
    } else if (operation === "upsert") {
      check(args.create as Record<string, unknown>);
      check(args.update as Record<string, unknown>);
    }
  }
}
