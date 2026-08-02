import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import authRouter from "./routes/auth.routes";
import documentsRouter from "./routes/documents.routes";
import packsRouter from "./routes/packs.routes";
import readinessRouter, { adminReadinessRouter } from "./routes/readiness.routes";
import aiRouter from "./routes/ai";
import gmailRouter from "./routes/gmail.routes";
import driveRouter from "./routes/drive.routes";
import bootstrapRouter from "./routes/bootstrap.routes";
import { corsOptions, generalApiLimiter, jsonBodyLimit, securityHeadersOptions } from "./middleware/security";
import { cleanupTemporaryUploads } from "./services/documentFileStorage";
import { assertDocumentEncryptionConfigured } from "./utils/documentEncryption";
import { errorHandler } from "./middleware/errorHandling";
import { assertDatabaseConfigured } from "./config/database";
import { loadEmailConfig } from "./config/email";
import { loadStorageConfig } from "./config/storage";
import { getActiveDocumentEncryptionKey } from "./services/documentHybridEncryption";
import { assertDocumentSecurityScannerConfigured } from "./services/documentSecurityValidation";

dotenv.config();
assertDatabaseConfigured();
loadEmailConfig();
loadStorageConfig();
assertDocumentEncryptionConfigured();
getActiveDocumentEncryptionKey();
assertDocumentSecurityScannerConfigured();

const app = express();
const port = Number(process.env.PORT || 4000);
const uploadsDir = path.resolve(process.cwd(), "uploads");

app.disable("x-powered-by");

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY);
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(helmet(securityHeadersOptions));
app.use(cors(corsOptions));
app.use(express.json({ limit: jsonBodyLimit }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "lifepack-backend",
    timestamp: new Date().toISOString(),
  });
});

app.use(generalApiLimiter);
app.use("/auth", authRouter);
app.use("/documents", documentsRouter);
app.use("/packs", packsRouter);
app.use("/packages", packsRouter);
app.use("/readiness", readinessRouter);
app.use("/admin/readiness", adminReadinessRouter);
app.use("/api/ai", aiRouter);
app.use("/api/integrations/gmail", gmailRouter);
app.use("/api/integrations/drive", driveRouter);
app.use("/api/bootstrap", bootstrapRouter);

app.use(errorHandler);

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
