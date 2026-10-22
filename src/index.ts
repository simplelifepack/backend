import { assertPrivateDataKeysConfigured } from "./privacy/fieldEncryption";
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

  app.listen(port, () => {
    console.log(`Readiness backend listening on http://localhost:${port}`);
  });
}

void start();
