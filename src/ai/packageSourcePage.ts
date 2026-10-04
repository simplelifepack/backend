import { lookup } from "node:dns";
import { get } from "node:https";
import { isIP } from "node:net";
import { Parser } from "htmlparser2";

export function packageSourceText(html: string) {
  const chunks: string[] = [];
  let excluded: string | null = null;
  const parser = new Parser({
    onopentag(name) { if (["script", "style"].includes(name)) excluded = name; if (!excluded) chunks.push(" "); },
    onclosetag(name) { if (name === excluded) excluded = null; if (!excluded) chunks.push(" "); },
    ontext(text) { if (!excluded) chunks.push(text); },
  }, { decodeEntities: true });
  parser.end(html);
  return chunks.join("").replace(/\s+/g, " ").trim();
}

export function publicSourceAddress(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a! >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && (b === 168 || b === 0)) || (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 198 && (b === 18 || b === 19)));
}

// Pin the connection to a checked public IPv4 address; validate every redirect too.
export async function readPackageSourcePage(value: string, signal: AbortSignal, redirects = 0): Promise<string> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || redirects > 3) throw new Error("Unsafe source URL.");
  const result = await new Promise<{ body?: Buffer; pdf?: boolean; redirect?: string }>((resolve, reject) => {
    const request = get(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
      family: 4,
      headers: { "User-Agent": "Readiness source verification", Accept: "text/html,text/plain,application/pdf" },
      lookup: (hostname, _options, callback) => lookup(hostname, { family: 4, all: true }, (error, addresses) => {
        if (error) return callback(error, "", 4);
        if (!addresses.length || addresses.some(item => !publicSourceAddress(item.address))) return callback(new Error("Private source address rejected."), "", 4);
        callback(null, addresses[0]!.address, 4);
      }),
    }, response => {
      if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume(); resolve({ redirect: new URL(response.headers.location, url).href }); return;
      }
      if (response.statusCode !== 200 || !/^(text\/html|text\/plain|application\/pdf)/i.test(response.headers["content-type"] ?? "")) {
        response.resume(); reject(new Error("Source page unavailable or unsupported.")); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2_000_000) { response.destroy(new Error("Source page too large.")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ body: Buffer.concat(chunks), pdf: /^application\/pdf/i.test(response.headers["content-type"] ?? "") }));
    });
    request.on("error", reject);
  });
  if (result.redirect) return readPackageSourcePage(result.redirect, signal, redirects + 1);
  signal.throwIfAborted();
  let text: string;
  if (result.pdf) {
    const runtime = globalThis as Record<string, unknown>;
    const canvas = await import("@napi-rs/canvas");
    runtime.DOMMatrix ??= canvas.DOMMatrix; runtime.ImageData ??= canvas.ImageData; runtime.Path2D ??= canvas.Path2D;
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: result.body! });
    try { text = (await parser.getText({ first: 20 })).text; }
    finally { await parser.destroy(); }
  } else text = packageSourceText(result.body!.toString("utf8"));
  text = text.replace(/\s+/g, " ").trim().slice(0, 60_000);
  if (text.length < 100) throw new Error("Source page contains no useful evidence.");
  signal.throwIfAborted();
  return text;
}
