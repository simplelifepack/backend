import { assertPrivateDataKeysConfigured } from "./privacy/fieldEncryption";
import { cleanupExpiredDigiLockerCredentials } from "./services/digilocker/digilocker.service";
import { app } from "./app";
import { cleanupTemporaryUploads } from "./services/documentFileStorage";

const port = Number(process.env.PORT || 4000);

async function start() {
  assertPrivateDataKeysConfigured();
  try {
    await cleanupTemporaryUploads();
  } catch {
    console.error({ event: "temporary_upload_cleanup_failed" });
  }

  try {
    await cleanupExpiredDigiLockerCredentials();
  } catch {
    console.error({ event: "digilocker_cleanup_failed" });
  }
  const digilockerCleanup = setInterval(() => {
    void cleanupExpiredDigiLockerCredentials().catch(() => console.error({ event: "digilocker_cleanup_failed" }));
  }, 60_000);
  digilockerCleanup.unref();
  app.listen(port, () => {
    console.log(`Readiness backend listening on http://localhost:${port}`);
  });
}

void start();
