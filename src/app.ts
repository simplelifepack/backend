import cors from "cors";
import express, { type Router } from "express";
import helmet from "helmet";
import authRouter from "./routes/auth.routes";
import bootstrapRouter from "./routes/bootstrap.routes";
import { openApiDocument } from "./docs/openapi";
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

app.get("/openapi.json", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(openApiDocument);
});

const swaggerUiVersion = "5.33.0";
const swaggerUiCdnBase = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${swaggerUiVersion}`;

app.get(["/api-docs", "/api-docs/"], (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' ${swaggerUiCdnBase}`,
      `style-src 'self' 'unsafe-inline' ${swaggerUiCdnBase}`,
      "img-src 'self' data:",
      "font-src 'self' https: data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ].join(";"),
  );
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Readiness API Docs</title>
  <link rel="stylesheet" href="${swaggerUiCdnBase}/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *::before, *::after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${swaggerUiCdnBase}/swagger-ui-bundle.js"></script>
  <script src="${swaggerUiCdnBase}/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        persistAuthorization: true,
        withCredentials: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`);
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
app.use("/api/health", lazyRouter(() => import("./routes/health.routes")));

app.use(errorHandler);

export { app };
export default app;
