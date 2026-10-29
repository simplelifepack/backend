export type EmailRenderResult = {
  subject: string;
  html: string;
  text: string;
};

// Email clients need literal colors and inline styles; these mirror the web light theme.
export const EMAIL_STYLE = {
  paper: "#F2F3F5",
  panel: "#FFFFFF",
  panelSoft: "#F7F7FA",
  border: "#E3E6EA",
  borderDeep: "#D5D9E0",
  ink: "#1B2431",
  body: "#39424F",
  muted: "#5E6674",
  primary: "#633CA6",
};

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function cleanDisplayName(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "there";
  return trimmed.slice(0, 80);
}

export function appHref(appUrl: string) {
  return escapeHtml(appUrl);
}

export function isPublicHttpsUrl(appUrl: string) {
  try {
    const parsed = new URL(appUrl);
    return parsed.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function brandHeader() {
  return `
    <tr>
      <td style="padding:0 0 24px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="vertical-align:middle;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="width:36px;vertical-align:middle;"><img src="https://readines.com/readiness-logo.png" width="36" height="36" alt="" style="display:block;border:0;width:36px;height:36px;"></td>
                  <td style="padding-left:11px;font-family:Inter,Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:${EMAIL_STYLE.ink};">Readines</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

export function ctaButton(label: string, href: string) {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0;">
      <tr>
        <td style="border-radius:12px;background:${EMAIL_STYLE.primary};">
          <a href="${appHref(href)}" style="display:inline-block;padding:13px 18px;border-radius:12px;color:#FFFFFF;text-decoration:none;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

export function appAccessBlock(label: string, appUrl: string) {
  return ctaButton(label, appUrl);
}

export function renderShell(content: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Readines</title>
    <style>@media only screen and (max-width:480px){.email-content{padding:24px 18px !important;}}a{overflow-wrap:anywhere;}td{overflow-wrap:break-word;}</style>
  </head>
  <body style="margin:0;padding:0;background:${EMAIL_STYLE.paper};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${EMAIL_STYLE.paper};">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;border:1px solid ${EMAIL_STYLE.border};border-radius:24px;background:${EMAIL_STYLE.panel};overflow:hidden;">
            <tr>
              <td class="email-content" style="background:${EMAIL_STYLE.panel};padding:32px 28px;font-family:Inter,Arial,Helvetica,sans-serif;color:${EMAIL_STYLE.body};">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  ${brandHeader()}
                  ${content}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
