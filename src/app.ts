import { productionDomainAccess } from "./middleware/domainAccess";
import { digiLockerCallbackEntry } from "./middleware/digilockerCallbackEntry";
import cors from "cors";
import express, { type Router } from "express";
import helmet from "helmet";
import path from "node:path";
import authRouter from "./routes/auth.routes";
import billingRouter from "./routes/billing.routes";
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
// Serverless cold starts should open SMTP only for an actual send. The manual
// verification command remains available without creating a competing handshake.
if (!process.env.VERCEL) verifyEmailProviderOnStartup();

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
app.use(productionDomainAccess);
app.use(digiLockerCallbackEntry);
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path === "/packages" || req.path.startsWith("/packages/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});
// Webhook HMAC must see the original bytes, before the global JSON parser.
app.use("/api/billing", generalApiLimiter, billingRouter);
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

function apiDocsEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.API_DOCS_ENABLED === "true";
}

function docsDisabled(res: express.Response) {
  return res.status(404).json({ message: "Not found." });
}

const swaggerUiAssetPath = path.dirname(require.resolve("swagger-ui-dist/package.json"));
const swaggerUiAssetRoute = "/api-docs/swagger-ui";

app.get("/openapi.json", (_req, res) => {
  if (!apiDocsEnabled()) return docsDisabled(res);
  res.setHeader("Cache-Control", "no-store");
  res.json(openApiDocument);
});

app.use(swaggerUiAssetRoute, (req, res, next) => {
  if (!apiDocsEnabled()) return docsDisabled(res);
  return express.static(swaggerUiAssetPath, {
    fallthrough: false,
    immutable: true,
    maxAge: "1y",
  })(req, res, next);
});

app.get(["/api-docs", "/api-docs/"], (_req, res) => {
  if (!apiDocsEnabled()) return docsDisabled(res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
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
  <link rel="stylesheet" href="${swaggerUiAssetRoute}/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *::before, *::after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${swaggerUiAssetRoute}/swagger-ui-bundle.js"></script>
  <script src="${swaggerUiAssetRoute}/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        filter: true,
        displayRequestDuration: true,
        displayOperationId: true,
        tagsSorter: "alpha",
        operationsSorter: "method",
        docExpansion: "list",
        persistAuthorization: false,
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
app.use("/api/waitlist", lazyRouter(() => import("./routes/waitlist.routes")));
app.use("/auth", authRouter);
app.use("/api/bootstrap", bootstrapRouter);
app.use("/api/search", lazyRouter(() => import("./routes/search.routes")));
app.use("/documents", lazyRouter(() => import("./routes/documents.routes")));
app.use("/packs", lazyRouter(() => import("./routes/packs.routes")));
app.use("/packages", lazyRouter(() => import("./routes/packs.routes")));
app.use("/api/packages", lazyRouter(() => import("./routes/packs.routes")));
app.use("/api/admin/packages", lazyRouter(() => import("./routes/adminPackages.routes")));
app.use("/admin/readiness", lazyRouter(() => import("./routes/readiness.admin.routes"), "adminReadinessRouter"));
app.use("/admin/notifications", lazyRouter(() => import("./routes/notifications.routes"), "adminNotificationsRouter"));
app.use("/admin/account", lazyRouter(() => import("./routes/account.routes"), "adminAccountRouter"));
// Future integration: intentionally disabled until Gmail work resumes.
// app.use("/api/integrations/gmail", lazyRouter(() => import("./routes/gmail.routes")));
// Future integration: intentionally disabled until Drive work resumes.
// app.use("/api/integrations/drive", lazyRouter(() => import("./routes/drive.routes")));
app.use("/api/integrations/digilocker", lazyRouter(() => import("./routes/digilocker.routes")));
app.use("/api/trust", lazyRouter(() => import("./routes/trust.routes")));
app.use("/api/wealth", lazyRouter(() => import("./routes/wealth.routes")));
app.use("/api/health", lazyRouter(() => import("./routes/health.routes")));
app.use("/api/notifications", lazyRouter(() => import("./routes/notifications.routes")));
app.use("/api/preferences", lazyRouter(() => import("./routes/preferences.routes")));
app.use("/api/account", lazyRouter(() => import("./routes/account.routes")));

app.use(errorHandler);

export { app };
export default app;
