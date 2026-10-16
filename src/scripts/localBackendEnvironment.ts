import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { assertPrivateDataKeysConfigured } from "../privacy/fieldEncryption";

// Never writes environment files, rotates keys, or accepts a remote database.
export function configureNormalLocalBackend(file: string | undefined) {
  if (!file) throw new Error("An explicit --env-file is required.");
  const envFile = path.resolve(file);
  const values = dotenv.parse(fs.readFileSync(envFile));
  const database = new URL(values.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.port !== "5434" || database.pathname !== "/lifepack" || values.APP_ENV !== "development" || values.STORAGE_DRIVER !== "local") throw new Error("This launcher accepts only the normal local lifepack database and local storage.");
  if (values.DIRECT_URL) {
    const direct = new URL(values.DIRECT_URL);
    if (direct.hostname !== database.hostname || direct.port !== database.port || direct.pathname !== database.pathname) throw new Error("Local database/direct targets must match.");
  }
  const envDirectory = path.dirname(envFile);
  Object.assign(process.env, values, {
    LOCAL_STORAGE_PATH: path.resolve(envDirectory, values.LOCAL_STORAGE_PATH || "uploads"),
    UPLOADS_DIR: path.resolve(envDirectory, values.UPLOADS_DIR || "uploads"),
  });
  if (!values.DOCUMENT_RSA_KEYRING_JSON && !values.DOCUMENT_RSA_PRIVATE_KEY) {
    const keyDirectory = path.join(envDirectory, ".secrets");
    process.env.DOCUMENT_RSA_KEYRING_JSON = JSON.stringify([{
      keyId: "lifepack-development", keyVersion: 1,
      publicKeyPem: fs.readFileSync(path.join(keyDirectory, "document-rsa-public.pem"), "utf8"),
      privateKeyPem: fs.readFileSync(path.join(keyDirectory, "document-rsa-private.pem"), "utf8"),
    }]);
  }
  assertPrivateDataKeysConfigured();
}
