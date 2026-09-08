import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { z } from "zod";

import { frontendUrl } from "./gmail/config";

export type OAuthPopupProvider = "gmail" | "drive";
export type OAuthPopupStatus = "connected" | "error";

export type OAuthPopupCallbackResult<Reason extends string = string> = {
  description?: string;
  provider: OAuthPopupProvider;
  reason?: Reason;
  status: OAuthPopupStatus;
};

type CompleteOAuthCallbackOptions<Reason extends string> = {
  authorize: (code: string, state: string) => Promise<unknown>;
  consumeDeniedState?: (state: string) => Promise<unknown>;
  mapError: (error: unknown) => Reason;
  provider: OAuthPopupProvider;
};

export function directOAuthRedirectUrl(result: OAuthPopupCallbackResult) {
  const url = new URL("/documents", frontendUrl());
  url.searchParams.set(result.provider, result.status);
  if (result.reason) url.searchParams.set("reason", result.reason);
  if (result.description) url.searchParams.set("description", result.description);
  return url.toString();
}

export async function completeOAuthPopupCallback<Reason extends string>(
  query: unknown,
  options: CompleteOAuthCallbackOptions<Reason>,
): Promise<OAuthPopupCallbackResult<Reason | "invalid_request" | "invalid_state" | "access_denied" | "authorization_failed">> {
  const parsed = z.object({
    code: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  }).safeParse(query);

  if (!parsed.success || (!parsed.data.code && !parsed.data.error)) {
    return { provider: options.provider, status: "error", reason: "invalid_request" };
  }

  if (parsed.data.error) {
    if (parsed.data.state && options.consumeDeniedState) {
      try { await options.consumeDeniedState(parsed.data.state); }
      catch { return { provider: options.provider, status: "error", reason: "invalid_state" }; }
    }
    const result: OAuthPopupCallbackResult<"access_denied" | "authorization_failed"> = {
      provider: options.provider,
      status: "error",
      reason: parsed.data.error === "access_denied" ? "access_denied" : "authorization_failed",
    };
    if (parsed.data.error_description) result.description = parsed.data.error_description;
    return result;
  }

  if (!parsed.data.state) {
    return { provider: options.provider, status: "error", reason: "invalid_request" };
  }

  try {
    await options.authorize(parsed.data.code!, parsed.data.state);
    return { provider: options.provider, status: "connected" };
  } catch (error) {
    return { provider: options.provider, status: "error", reason: options.mapError(error) };
  }
}

export function renderOAuthPopupCallback(result: OAuthPopupCallbackResult, nonce: string) {
  const appOrigin = new URL(frontendUrl()).origin;
  const redirectUrl = directOAuthRedirectUrl(result);
  const message = {
    type: `readiness:${result.provider}-oauth`,
    provider: result.provider,
    status: result.status,
    reason: result.reason,
    description: result.description,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Readiness connection complete</title>
  <style nonce="${nonce}">
    body { margin: 0; background: #10151f; color: #f7efe0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: none; min-height: 100vh; place-items: center; padding: 1.5rem; text-align: center; }
    p { color: #b8c0cc; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>Returning to Readiness...</h1>
    <p>This window was opened directly, so Readiness will reopen the Documents page.</p>
  </main>
  <script nonce="${nonce}">
    (() => {
      const targetOrigin = ${JSON.stringify(appOrigin)};
      const fallbackUrl = ${JSON.stringify(redirectUrl)};
      const message = ${JSON.stringify(message)};
      if (!window.opener || window.opener.closed) {
        document.querySelector("main").style.display = "grid";
        window.location.replace(fallbackUrl);
        return;
      }
      window.opener.postMessage(message, targetOrigin);
      window.close();
    })();
  </script>
</body>
</html>`;
}

export function sendOAuthPopupCallback(res: Response, result: OAuthPopupCallbackResult) {
  const nonce = randomBytes(16).toString("base64");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  return res.status(200).type("html").send(renderOAuthPopupCallback(result, nonce));
}
