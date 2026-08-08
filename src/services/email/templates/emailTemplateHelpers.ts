export type EmailRenderResult = {
  subject: string;
  html: string;
  text: string;
};

export const EMAIL_STYLE = {
  paper: "#F3EBDA",
  panel: "#FFFFFF",
  panelSoft: "#FAF3E7",
  border: "#E3D8C2",
  borderDeep: "#D8C8AA",
  ink: "#221E17",
  body: "#4C443A",
  muted: "#897E6D",
  gold: "#A87C22",
  goldFill: "#D8B25A",
  goldSoft: "#F0E4C6",
  emerald: "#1F9D66",
  clay: "#B85C42",
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
                  <td style="width:36px;height:36px;border-radius:10px;background:${EMAIL_STYLE.goldFill};text-align:center;vertical-align:middle;color:#3A2E12;font-weight:800;font-size:13px;font-family:Arial,Helvetica,sans-serif;">LP</td>
                  <td style="padding-left:11px;font-family:'Space Grotesk',Inter,Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:${EMAIL_STYLE.ink};">LifePack</td>
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
        <td style="border-radius:12px;background:${EMAIL_STYLE.goldFill};">
          <a href="${appHref(href)}" style="display:inline-block;padding:13px 18px;border-radius:12px;color:#3A2E12;text-decoration:none;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

export function appAccessBlock(label: string, appUrl: string) {
  return ctaButton(label, appUrl);
}

export function renderShell(content: string) {
  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>LifePack</title>
  </head>
  <body style="margin:0;padding:0;background:${EMAIL_STYLE.paper};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${EMAIL_STYLE.paper};">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;border:1px solid ${EMAIL_STYLE.border};border-radius:24px;background:${EMAIL_STYLE.panel};box-shadow:0 18px 42px rgba(80,60,30,.12);overflow:hidden;">
            <tr>
              <td style="background:${EMAIL_STYLE.panelSoft};padding:32px 28px;font-family:Inter,Arial,Helvetica,sans-serif;color:${EMAIL_STYLE.body};">
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
