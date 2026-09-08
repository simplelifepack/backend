import cors from "cors";
import express, { type Router } from "express";
import helmet from "helmet";
import authRouter from "./routes/auth.routes";
import bootstrapRouter from "./routes/bootstrap.routes";
import { corsOptions, generalApiLimiter, jsonBodyLimit, securityHeadersOptions } from "./middleware/security";
import { assertDocumentEncryptionConfigured } from "./utils/documentEncryption";
import { errorHandler } from "./middleware/errorHandling";
import { assertDatabaseConfigured } from "./config/database";
import { loadEmailConfig } from "./config/email";
import { loadBackendEnv } from "./config/env";
import { loadStorageConfig } from "./config/storage";
import { getActiveDocumentEncryptionKey } from "./services/documentHybridEncryption";
import { verifyEmailProviderOnStartup } from "./services/email/emailService";

loadBackendEnv();
assertDatabaseConfigured();
loadEmailConfig();
loadStorageConfig();
assertDocumentEncryptionConfigured();
getActiveDocumentEncryptionKey();
verifyEmailProviderOnStartup();

const app = express();
app.disable("x-powered-by");
app.disable("etag");

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY);
}

app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production" && !req.secure && !(process.env.VERCEL && req.get("x-forwarded-proto") === "https")) {
    return res.status(400).json({ message: "HTTPS is required." });
  }
  next();
});
app.use(helmet(securityHeadersOptions));
app.use(cors(corsOptions));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path === "/packages" || req.path.startsWith("/packages/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});
app.use(express.json({ limit: jsonBodyLimit }));

function lazyRouter(loader: () => Promise<Record<string, unknown>>, exportName = "default") {
  let loaded: Router | null = null;
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      if (!loaded) {
        const mod = await loader();
        loaded = mod[exportName] as Router;
      }
      return loaded(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "readiness-backend",
    timestamp: new Date().toISOString(),
  });
});

app.use(generalApiLimiter);
app.use("/auth", authRouter);
app.use("/api/bootstrap", bootstrapRouter);
app.use("/documents", lazyRouter(() => import("./routes/documents.routes")));
app.use("/packs", lazyRouter(() => import("./routes/packs.routes")));
app.use("/packages", lazyRouter(() => import("./routes/packs.routes")));
app.use("/api/packages", lazyRouter(() => import("./routes/packs.routes")));
app.use("/admin/readiness", lazyRouter(() => import("./routes/readiness.admin.routes"), "adminReadinessRouter"));
app.use("/api/integrations/gmail", lazyRouter(() => import("./routes/gmail.routes")));
app.use("/api/integrations/drive", lazyRouter(() => import("./routes/drive.routes")));
app.use("/api/trust", lazyRouter(() => import("./routes/trust.routes")));
app.use("/api/wealth", lazyRouter(() => import("./routes/wealth.routes")));

app.use(errorHandler);

export { app };
export default app;
