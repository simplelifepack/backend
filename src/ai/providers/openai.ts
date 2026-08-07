import type { AIReadinessPackage } from "../intentTypes";
import type { AIProvider } from "./types";
import { normalizeRequirementDocumentTypes } from "../../services/readiness/normalization";

type OpenAIResponse = { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };

const MAX_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 4_000;

export class OpenAIProvider implements AIProvider {
  readonly name = "OpenAIProvider";

  constructor(private readonly apiKey: string, readonly model = process.env.OPENAI_INTENT_MODEL ?? "gpt-5-mini") {}

  async analyzeIntent(query: string): Promise<AIReadinessPackage> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      try {
        const result = await this.requestAnalysis(query);
        console.info("[LifePack AI] OpenAI request completed", {
          attempt,
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown OpenAI error.");
        console.warn("[LifePack AI] OpenAI request attempt failed", {
          attempt,
          durationMs: Date.now() - startedAt,
          retryable: isRetryable(lastError),
          message: lastError.message,
        });
        if (attempt === MAX_ATTEMPTS || !isRetryable(lastError)) break;
        await delay(200 * 2 ** (attempt - 1));
      }
    }
    throw lastError ?? new Error("OpenAI intent analysis failed.");
  }

  private async requestAnalysis(query: string): Promise<AIReadinessPackage> {
    const timeoutMs = readRequestTimeout();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: process.env.OPENAI_REASONING_EFFORT ?? "low" },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        tools: [{ type: process.env.OPENAI_WEB_SEARCH_TOOL_TYPE ?? "web_search", search_context_size: "medium" }],
        instructions: [
          "LifePack is a readiness engine, not a chatbot.",
          "Use web search to find the official source before creating the package.",
          "Prefer government, embassy, immigration authority, official bank, university, insurance, or regulatory authority websites. Avoid blogs, forums, Reddit, Quora, and SEO pages.",
          "Convert the user's goal into exactly one practical readiness package using only requirements supported by the sources.",
          "Return only the required JSON schema. Never return prose, markdown, advice, or suggested steps.",
          "List the documents required or commonly requested by the cited official sources for the user's jurisdiction and goal.",
          "Set sourceTitle, sourceUrl, sourceOrganization, and lastChecked from the primary official source used.",
          "Include every official source used in verificationSources with title, organization, URL, type, and retrievedAt ISO date.",
          "If no official government, university, embassy, licensing authority, bank, insurer, or organization source can be identified, do not create a package.",
          "Never label a package as AI generated. Never return needs_review.",
          "Every requirement must include a stable normalized id, normalized documentType, explicit owner, title, category, and required boolean.",
          "Use owner self for the user or buyer unless the requirement belongs to another party such as seller, spouse, employer, bank, hospital, or government.",
          "Use concise document names and group each document by category. Never encode owner only in the title.",
        ].join(" "),
        input: query,
        text: { format: { type: "json_schema", name: "lifepack_readiness_package", strict: true, schema: {
          type: "object",
          properties: {
            packageName: { type: "string" },
            category: { type: "string" },
            description: { type: "string" },
            sourceTitle: { type: "string" },
            sourceUrl: { type: "string" },
            sourceOrganization: { type: "string" },
            lastChecked: { type: "string" },
            verificationSources: { type: "array", items: {
              type: "object",
              properties: {
                title: { type: "string" },
                organization: { type: "string" },
                url: { type: "string" },
                type: { type: "string", enum: ["government", "official", "bank", "university", "insurance", "authority"] },
                retrievedAt: { type: "string" },
              },
              required: ["title", "organization", "url", "type", "retrievedAt"],
              additionalProperties: false,
            } },
            lastVerifiedAt: { type: ["string", "null"] },
            verificationStatus: { type: "string", enum: ["verified"] },
            requiredDocuments: { type: "array", items: {
              type: "object",
              properties: {
                id: { type: "string" }, category: { type: "string" },
                documentType: { type: "string" }, owner: { type: "string", enum: ["self", "spouse", "father", "mother", "child", "seller", "buyer", "employer", "bank", "hospital", "government", "other"] },
                name: { type: "string" }, title: { type: "string" }, required: { type: "boolean" },
              },
              required: ["id", "category", "documentType", "owner", "name", "title", "required"],
              additionalProperties: false,
            } },
          },
          required: ["packageName", "category", "description", "sourceTitle", "sourceUrl", "sourceOrganization", "lastChecked", "verificationSources", "lastVerifiedAt", "verificationStatus", "requiredDocuments"],
          additionalProperties: false,
        } } },
      }),
    });
    if (!response.ok) throw new OpenAIRequestError(response.status, await response.text());
    const payload = (await response.json()) as OpenAIResponse;
    const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!text) throw new Error("OpenAI returned no structured intent output.");
    return validateIntentAnalysis(JSON.parse(text));
  }
}

class OpenAIRequestError extends Error {
  constructor(readonly status: number, readonly body = "") {
    super(`OpenAI intent request failed with status ${status}${body ? `: ${body.slice(0, 500)}` : ""}`);
  }
}

class MissingAuthoritativeSourceError extends Error {
  constructor() {
    super("OpenAI returned a package without an authoritative source.");
  }
}

function isRetryable(error: Error) {
  if (error instanceof OpenAIRequestError) {
    return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof MissingAuthoritativeSourceError) return true;
  // Retrying a locally aborted request simply repeats the full timeout window.
  // Retry transient connection failures, but return promptly after our deadline.
  return error.name !== "TimeoutError" && error.name !== "AbortError" && error instanceof TypeError;
}

function readRequestTimeout() {
  const configured = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000 && configured <= 120_000
    ? configured
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateIntentAnalysis(value: unknown): AIReadinessPackage {
  if (!value || typeof value !== "object") throw new Error("Invalid readiness package output.");
  const result = value as Record<string, unknown>;
  if (typeof result.packageName !== "string" || !result.packageName.trim() || typeof result.category !== "string" || !result.category.trim() || typeof result.description !== "string" || !Array.isArray(result.requiredDocuments)) throw new Error("Invalid readiness package output.");
  const documents = result.requiredDocuments.filter(isRequiredDocument);
  if (!documents.length) throw new Error("Readiness package contains no required documents.");
  const sources = verificationSources(result.verificationSources);
  const primarySource = authoritativePrimarySource(result, sources);
  if (!primarySource) throw new MissingAuthoritativeSourceError();
  const checkedAt = checkedDate(result.lastChecked, result.lastVerifiedAt, primarySource.retrievedAt);
  return {
    packageName: result.packageName.trim().slice(0, 120),
    category: result.category.trim().slice(0, 60),
    description: result.description.trim().slice(0, 200),
    sourceTitle: primarySource.title,
    sourceUrl: primarySource.url,
    sourceOrganization: primarySource.organization,
    lastChecked: checkedAt,
    verificationSources: sources,
    lastVerifiedAt: checkedAt,
    verificationStatus: "verified",
    requiredDocuments: documents.map((item) => ({
      id: normalizeId(item.id), category: item.category.trim().slice(0, 60),
      documentType: normalizeRequirementDocumentTypes(item.documentType, item.title)[0]!, owner: item.owner,
      name: item.name.trim().slice(0, 100), title: item.title.trim().slice(0, 100), required: item.required,
    })).filter((item) => item.id && item.category && item.documentType && item.name && item.title).slice(0, 30),
  };
}

function authoritativePrimarySource(result: Record<string, unknown>, sources: AIReadinessPackage["verificationSources"]) {
  const sourceTitle = typeof result.sourceTitle === "string" ? result.sourceTitle.trim().slice(0, 140) : "";
  const sourceUrl = typeof result.sourceUrl === "string" ? result.sourceUrl.trim() : "";
  const sourceOrganization = typeof result.sourceOrganization === "string" ? result.sourceOrganization.trim().slice(0, 120) : "";
  const directSource = sourceTitle && sourceOrganization && isAuthoritativeUrl(sourceUrl, "official")
    ? {
      title: sourceTitle,
      organization: sourceOrganization,
      url: sourceUrl,
      type: sourceTypeForUrl(sourceUrl),
      retrievedAt: checkedDate(result.lastChecked, result.lastVerifiedAt),
    }
    : null;
  if (directSource) return directSource;
  return sources[0] ?? null;
}

function verificationSources(value: unknown): AIReadinessPackage["verificationSources"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      title: typeof item.title === "string" ? item.title.trim().slice(0, 140) : "",
      organization: typeof item.organization === "string" ? item.organization.trim().slice(0, 120) : "",
      url: typeof item.url === "string" ? item.url.trim() : "",
      type: isSourceType(item.type) ? item.type : "official",
      retrievedAt: typeof item.retrievedAt === "string" && !Number.isNaN(Date.parse(item.retrievedAt)) ? new Date(item.retrievedAt).toISOString() : new Date().toISOString(),
    }))
    .filter((source) => source.title && source.organization && isAuthoritativeUrl(source.url, source.type))
    .slice(0, 8);
}

function checkedDate(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
      return new Date(value).toISOString();
    }
  }
  return new Date().toISOString();
}

function isSourceType(value: unknown): value is AIReadinessPackage["verificationSources"][number]["type"] {
  return typeof value === "string" && ["government", "official", "bank", "university", "insurance", "authority"].includes(value);
}

function isAuthoritativeUrl(value: string, sourceType: AIReadinessPackage["verificationSources"][number]["type"]) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const blocked = ["reddit.", "quora.", "medium.", "blogspot.", "wordpress.", "tripadvisor.", "visaguide.", "y-axis.", "makevisas.", "btwvisas.", "atlys.", "wikipedia."];
    if (blocked.some((domain) => host.includes(domain))) return false;
    if (sourceType === "bank" && host.includes("bank")) return true;
    if (sourceType === "university" && (host.endsWith(".edu") || host.includes(".edu.") || host.includes(".ac."))) return true;
    if (sourceType === "insurance" && host.includes("insurance")) return true;
    if (sourceType === "official" || sourceType === "authority") {
      const knownOfficialHosts = ["ucas.com", "vfsglobal.com", "ox.ac.uk", "harvard.edu", "homeaffairs.gov.au", "travel.state.gov"];
      if (knownOfficialHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;
    }
    return /\.(gov|gob|go|gc|gouv|govt)\./.test(host) ||
      host.endsWith(".gov") ||
      host.endsWith(".go.jp") ||
      host.endsWith(".gov.in") ||
      host.includes("embassy") ||
      host.includes("emb-japan") ||
      host.includes("mofa.go.jp") ||
      host.includes("canada.ca") ||
      host.includes("immigration") ||
      host.includes("vfs");
  } catch {
    return false;
  }
}

function sourceTypeForUrl(value: string): AIReadinessPackage["verificationSources"][number]["type"] {
  const host = new URL(value).hostname.toLowerCase();
  if (host.endsWith(".edu") || host.includes(".edu.") || host.includes(".ac.")) return "university";
  if (host.includes("bank")) return "bank";
  if (host.includes("insurance")) return "insurance";
  if (host.includes("gov") || host.includes("gouv") || host.includes("canada.ca") || host.includes("mofa.go.jp")) return "government";
  return "official";
}

function isRequiredDocument(item: unknown): item is AIReadinessPackage["requiredDocuments"][number] {
  if (!item || typeof item !== "object") return false;
  const value = item as Record<string, unknown>;
  return typeof value.id === "string" && typeof value.category === "string" && typeof value.documentType === "string" && typeof value.owner === "string" && typeof value.name === "string" && typeof value.title === "string" && typeof value.required === "boolean";
}

function normalizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100);
}
