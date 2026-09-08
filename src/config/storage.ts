export type LocalStorageConfig = {
  driver: "local";
  localPath: string;
};

export type S3StorageConfig = {
  driver: "s3";
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export type StorageConfig = LocalStorageConfig | S3StorageConfig;

function required(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=${env.STORAGE_DRIVER?.trim() || "local"}.`);
  return value;
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either "true" or "false".`);
}

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const driver = (env.STORAGE_DRIVER?.trim() || "local").toLowerCase();
  if (driver === "local") {
    return {
      driver,
      localPath: required("LOCAL_STORAGE_PATH", { ...env, STORAGE_DRIVER: driver }),
    };
  }
  if (driver === "s3") {
    if (env.STORAGE_ENDPOINT && new URL(env.STORAGE_ENDPOINT).protocol !== "https:" && env.NODE_ENV === "production") throw new Error("Production storage requires HTTPS.");
    return {
      driver,
      endpoint: env.STORAGE_ENDPOINT?.trim() || undefined,
      region: required("STORAGE_REGION", env),
      bucket: required("STORAGE_BUCKET", env),
      accessKeyId: required("STORAGE_ACCESS_KEY_ID", env),
      secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY", env),
      forcePathStyle: parseBoolean("STORAGE_FORCE_PATH_STYLE", env.STORAGE_FORCE_PATH_STYLE, false),
    };
  }
  throw new Error(`Unsupported storage driver: ${driver}. Expected "local" or "s3".`);
}
