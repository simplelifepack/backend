import { app } from "./app";
import { cleanupTemporaryUploads } from "./services/documentFileStorage";

const port = Number(process.env.PORT || 4000);

async function start() {
  try {
    await cleanupTemporaryUploads();
  } catch (error) {
    console.error("Temporary upload cleanup failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  app.listen(port, () => {
    console.log(`LifePack backend listening on http://localhost:${port}`);
  });
}

void start();
