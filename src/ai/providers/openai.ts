import { readProviderStream } from "../providerStream";
import type { AIReadinessPackage } from "../intentTypes";
import type { AIProvider, ProviderRequestOptions } from "./types";
import { normalizeRequirementDocumentTypes } from "../../services/readiness/normalization";
import { rankSources } from "../sourceAuthority";

type OpenAIResponse = {
  status?: string;
  error?: unknown;
  incomplete_details?: unknown;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
};

const MAX_ATTEMPTS = 3;
// One bounded server deadline; client disconnection also cancels the upstream request.
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MAX_REQUEST_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 8_500;

export class OpenAIProvider implements AIProvider {
  readonly name = "OpenAIProvider";

  constructor(private readonly apiKey: string, readonly model = process.env.OPENAI_REQUIREMENTS_MODEL ?? process.env.OPENAI_INTENT_MODEL ?? "gpt-5.4-mini") {}

  async analyzeIntent(query: string, options: ProviderRequestOptions = {}): Promise<AIReadinessPackage> {
    options.signal?.throwIfAborted();
    const refundBeforeInvocation = await options.beforeRequest?.();
    if (options.signal?.aborted) {
      await refundBeforeInvocation?.();
      options.signal.throwIfAborted();
    }
    let lastError: Error | null = null;
    const deadline = Date.now() + readRequestTimeout();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      try {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new DOMException("Requirements generation timed out.", "TimeoutError");
        const result = await this.requestAnalysis(query, remainingMs, options);
        console.info("[Readiness AI] OpenAI request completed", {
          attempt,
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown OpenAI error.");
        console.warn("[Readiness AI] OpenAI request attempt failed", {
          attempt,
          durationMs: Date.now() - startedAt,
          retryable: isRetryable(lastError),
          name: lastError.name,
          message: lastError.message,
          status: (lastError as { status?: number }).status,
          cause: safeErrorCause((lastError as { cause?: unknown }).cause),
        });
        if (options.signal?.aborted || options.onDelta || attempt === MAX_ATTEMPTS || !isRetryable(lastError)) break;
        await delay(Math.min(200 * 2 ** (attempt - 1), Math.max(0, deadline - Date.now())));
      }
    }
    throw lastError ?? new Error("OpenAI intent analysis failed.");
  }

  private async requestAnalysis(query: string, timeoutMs: number, options: ProviderRequestOptions): Promise<AIReadinessPackage> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        store: false,
        stream: Boolean(options.onDelta),
        reasoning: { effort: process.env.OPENAI_REQUIREMENTS_REASONING_EFFORT ?? process.env.OPENAI_REASONING_EFFORT ?? "none" },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        tools: [{ type: process.env.OPENAI_WEB_SEARCH_TOOL_TYPE ?? "web_search", search_context_size: "low" }],
        instructions: [
          "Readiness is a readiness engine, not a chatbot.",
          "Use web search to find the official source before creating the package.",
          "Prefer government, embassy, immigration authority, official bank, university, insurance, or regulatory authority websites. Avoid blogs, forums, Reddit, Quora, and SEO pages.",
          "Convert the user's goal into exactly one practical readiness package using only requirements supported by the sources.",
          "Return only the required JSON schema. Never return prose, markdown, advice, or suggested steps.",
          "List the documents required or commonly requested by the cited official sources for the user's jurisdiction and goal.",
          "Set sourceTitle, sourceUrl, sourceOrganization, and lastChecked from the primary official source used.",
          "Include every official source used in verificationSources with title, organization, URL, type, and retrievedAt ISO date.",
          "If no official government, university, embassy, licensing authority, bank, insurer, or organization source can be identified, do not create a package.",
          "Never label a package as AI generated. Never return needs_review.",
          "Every requirement must include a stable normalized id, normalized documentType, explicit owner, title, category, required boolean, whyNeeded, sourceName, sourceUrl, sourceAuthorityTier, and lastVerifiedAt.",
          "Use owner self for the user or buyer unless the requirement belongs to another party such as seller, spouse, employer, bank, hospital, or government.",
          "Use concise document names and group each document by category. Never encode owner only in the title.",
          "Return concise factual searchMetadata for discovery only: intent, subject, purpose, jurisdiction, destination when relevant, and at most 8 natural searchPhrases. Do not invent a jurisdiction or destination.",
        ].join(" "),
        input: query,
        text: { format: { type: "json_schema", name: "readiness_readiness_package", strict: true, schema: {
          type: "object",
          properties: {
            packageName: { type: "string" },
            category: { type: "string" },
            description: { type: "string" },
            searchMetadata: { type: "object", properties: {
              intent: { type: ["string", "null"] }, subject: { type: ["string", "null"] }, purpose: { type: ["string", "null"] },
              jurisdiction: { type: ["string", "null"] }, destination: { type: ["string", "null"] },
              searchPhrases: { type: "array", items: { type: "string" } },
            }, required: ["intent", "subject", "purpose", "jurisdiction", "destination", "searchPhrases"], additionalProperties: false },
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
                whyNeeded: { type: "string" }, sourceName: { type: "string" }, sourceUrl: { type: "string" },
                sourceAuthorityTier: { type: "string", enum: ["government", "authority", "official", "commercial", "aggregator"] },
                lastVerifiedAt: { type: "string" },
              },
              required: ["id", "category", "documentType", "owner", "name", "title", "required", "whyNeeded", "sourceName", "sourceUrl", "sourceAuthorityTier", "lastVerifiedAt"],
              additionalProperties: false,
            } },
          },
          required: ["packageName", "category", "description", "searchMetadata", "sourceTitle", "sourceUrl", "sourceOrganization", "lastChecked", "verificationSources", "lastVerifiedAt", "verificationStatus", "requiredDocuments"],
          additionalProperties: false,
        } } },
      }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new OpenAIRequestError(response.status); }
    if (options.onDelta) return validateIntentAnalysis(JSON.parse(await readProviderStream(response, options.onDelta)));
    const payload = (await response.json()) as OpenAIResponse;
    const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!text) {
      console.warn("[Readiness AI] OpenAI response contained no structured intent output", {
        status: payload.status,
        error: payload.error,
        incomplete_details: payload.incomplete_details,
        outputItemTypes: payload.output?.flatMap((item) => [item.type, ...(item.content ?? []).map((content) => content.type)]).filter(Boolean),
      });
      throw new Error("OpenAI returned no structured intent output.");
    }
    return validateIntentAnalysis(JSON.parse(text));
  }
}

class OpenAIRequestError extends Error {
  constructor(readonly status: number) {
    super(`OpenAI intent request failed with status ${status}`);
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
  return Number.isFinite(configured) && configured >= 1_000 && configured <= MAX_REQUEST_TIMEOUT_MS
    ? configured
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function safeErrorCause(cause: unknown) {
  if (!cause) return undefined;
  if (cause instanceof Error) return { name: cause.name, message: cause.message };
  if (typeof cause === "string" || typeof cause === "number" || typeof cause === "boolean") return cause;
  return String(cause);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function validateIntentAnalysis(value: unknown): AIReadinessPackage {
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
    searchMetadata: validatedSearchMetadata(result.searchMetadata),
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
      whyNeeded: item.whyNeeded.trim().slice(0, 300), sourceName: item.sourceName.trim().slice(0, 140),
      sourceUrl: item.sourceUrl.trim(), sourceAuthorityTier: item.sourceAuthorityTier,
      lastVerifiedAt: new Date(item.lastVerifiedAt).toISOString(),
    })).filter((item) => item.id && item.category && item.documentType && item.name && item.title).slice(0, 30),
  };
}

function validatedSearchMetadata(value: unknown): AIReadinessPackage["searchMetadata"] {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof input[key] === "string" && input[key] ? String(input[key]).trim().slice(0, 100) : undefined;
  return { intent: text("intent"), subject: text("subject"), purpose: text("purpose"), jurisdiction: text("jurisdiction"), destination: text("destination"), searchPhrases: Array.isArray(input.searchPhrases) ? input.searchPhrases.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 160)] : []).slice(0, 8) : [] };
}

function authoritativePrimarySource(result: Record<string, unknown>, sources: AIReadinessPackage["verificationSources"]) {
  const sourceTitle = typeof result.sourceTitle === "string" ? result.sourceTitle.trim().slice(0, 140) : "";
  const sourceUrl = typeof result.sourceUrl === "string" ? result.sourceUrl.trim() : "";
  const sourceOrganization = typeof result.sourceOrganization === "string" ? result.sourceOrganization.trim().slice(0, 120) : "";
  const directSourceType = sourceTypeForUrl(sourceUrl, sourceOrganization);
  const directSource = sourceTitle && sourceOrganization && isAuthoritativeUrl(sourceUrl, directSourceType, sourceOrganization)
    ? {
      title: sourceTitle,
      organization: sourceOrganization,
      url: sourceUrl,
      type: directSourceType,
      retrievedAt: checkedDate(result.lastChecked, result.lastVerifiedAt),
    }
    : null;
  if (directSource) return directSource;
  return sources[0] ?? null;
}

function verificationSources(value: unknown): AIReadinessPackage["verificationSources"] {
  if (!Array.isArray(value)) return [];
  return rankSources(value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const organization = typeof item.organization === "string" ? item.organization.trim().slice(0, 120) : "";
      const url = typeof item.url === "string" ? item.url.trim() : "";
      return {
        title: typeof item.title === "string" ? item.title.trim().slice(0, 140) : "",
        organization,
        url,
        type: sourceTypeForUrl(url, organization, isSourceType(item.type) ? item.type : "official"),
        retrievedAt: typeof item.retrievedAt === "string" && !Number.isNaN(Date.parse(item.retrievedAt)) ? new Date(item.retrievedAt).toISOString() : new Date().toISOString(),
      };
    })
    .filter((source) => source.title && source.organization && isAuthoritativeUrl(source.url, source.type, source.organization))
    .slice(0, 8));
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

function isAuthoritativeUrl(value: string, sourceType: AIReadinessPackage["verificationSources"][number]["type"], sourceName = "") {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const sourceText = `${sourceName.toLowerCase()} ${host}`;
    const blocked = ["reddit.", "quora.", "medium.", "blogspot.", "wordpress.", "tripadvisor.", "visaguide.", "y-axis.", "makevisas.", "btwvisas.", "atlys.", "wikipedia."];
    if (blocked.some((domain) => host.includes(domain))) return false;
    if (sourceType === "bank" && (sourceText.includes("bank") || sourceText.includes("credit union") || sourceText.includes("federal credit"))) return true;
    if (sourceType === "university" && (host.endsWith(".edu") || host.includes(".edu.") || host.includes(".ac.") || sourceText.includes("university") || sourceText.includes("college"))) return true;
    if (sourceType === "insurance" && (sourceText.includes("insurance") || sourceText.includes("insurer"))) return true;
    if (sourceType === "official" || sourceType === "authority") {
      const knownOfficialHosts = ["ucas.com", "vfsglobal.com", "ox.ac.uk", "harvard.edu", "homeaffairs.gov.au", "travel.state.gov", "ielts.org", "toefl.org", "ets.org"];
      if (knownOfficialHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;
    }
    if ((sourceType === "official" || sourceType === "authority") && (host.endsWith(".org") || host.includes(".org."))) return true;
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

function sourceTypeForUrl(value: string, sourceName = "", fallback: AIReadinessPackage["verificationSources"][number]["type"] = "official"): AIReadinessPackage["verificationSources"][number]["type"] {
  const host = hostForUrl(value);
  const sourceText = `${sourceName.toLowerCase()} ${host}`;
  if (host.endsWith(".edu") || host.includes(".edu.") || host.includes(".ac.") || sourceText.includes("university") || sourceText.includes("college")) return "university";
  if (sourceText.includes("bank") || sourceText.includes("credit union") || sourceText.includes("federal credit")) return "bank";
  if (sourceText.includes("insurance") || sourceText.includes("insurer")) return "insurance";
  if (host.includes("gov") || host.includes("gouv") || host.includes("canada.ca") || host.includes("mofa.go.jp")) return "government";
  return fallback;
}

function authoritativeSourceTypeForRequiredDocument(value: Record<string, unknown>): AIReadinessPackage["verificationSources"][number]["type"] {
  const explicitTier = String(value.sourceAuthorityTier);
  if (explicitTier === "government" || explicitTier === "authority") return explicitTier;
  const url = typeof value.sourceUrl === "string" ? value.sourceUrl : "";
  const sourceName = typeof value.sourceName === "string" ? value.sourceName.toLowerCase() : "";
  const host = hostForUrl(url);
  const sourceText = `${sourceName} ${host}`;
  if (host.endsWith(".edu") || host.includes(".edu.") || host.includes(".ac.") || sourceText.includes("university") || sourceText.includes("college")) return "university";
  if (sourceText.includes("bank") || sourceText.includes("credit union") || sourceText.includes("federal credit")) return "bank";
  if (sourceText.includes("insurance") || sourceText.includes("insurer")) return "insurance";
  if (host.includes("gov") || host.includes("gouv") || host.includes("canada.ca") || host.includes("mofa.go.jp")) return "government";
  return "official";
}

function hostForUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isRequiredDocument(item: unknown): item is AIReadinessPackage["requiredDocuments"][number] {
  if (!item || typeof item !== "object") return false;
  const value = item as Record<string, unknown>;
  return typeof value.id === "string" && typeof value.category === "string" && typeof value.documentType === "string" && typeof value.owner === "string" && typeof value.name === "string" && typeof value.title === "string" && typeof value.required === "boolean" && typeof value.whyNeeded === "string" && Boolean(value.whyNeeded.trim()) && typeof value.sourceName === "string" && Boolean(value.sourceName.trim()) && typeof value.sourceUrl === "string" && ["government", "authority", "official", "commercial", "aggregator"].includes(String(value.sourceAuthorityTier)) && isAuthoritativeUrl(value.sourceUrl, authoritativeSourceTypeForRequiredDocument(value), value.sourceName) && typeof value.lastVerifiedAt === "string" && !Number.isNaN(Date.parse(value.lastVerifiedAt));
}

function normalizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100);
}
