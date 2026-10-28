import { readProviderStream } from "../providerStream";
import type { AIReadinessPackage } from "../intentTypes";
import type { AIProvider, ProviderRequestOptions } from "./types";
import { normalizeRequirementDocumentTypes } from "../../services/readiness/normalization";
import { rankSources } from "../sourceAuthority";
import { validateIntentAnalysis } from "./openaiValidation";


export type OpenAIResponse = {
  status?: string;
  error?: unknown;
  incomplete_details?: unknown;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
};


export const MAX_ATTEMPTS = 3;

// One bounded server deadline; client disconnection also cancels the upstream request.
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export const MAX_REQUEST_TIMEOUT_MS = 90_000;

export const MAX_OUTPUT_TOKENS = 8_500;


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
        const delayMs = retryDelayMs(lastError, attempt, deadline);
        await options.onRetry?.({ attempt, delayMs, status: (lastError as { status?: number }).status });
        await delay(delayMs);
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
          options.allowUnverifiedGuidance
            ? "If no official government, university, embassy, licensing authority, bank, insurer, or organization source can be identified, return a best-effort guidance checklist with verificationStatus unverified_guidance, confidence low, hasVerifiedOfficialSource false, empty verificationSources, and no fabricated URLs or authorities."
            : "If no official government, university, embassy, licensing authority, bank, insurer, or organization source can be identified, do not create a package.",
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
            hasVerifiedOfficialSource: { type: "boolean" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            disclaimer: { type: ["string", "null"] },
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
            verificationStatus: { type: "string", enum: ["verified", "unverified_guidance"] },
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
          required: ["packageName", "category", "description", "searchMetadata", "sourceTitle", "sourceUrl", "sourceOrganization", "lastChecked", "hasVerifiedOfficialSource", "confidence", "disclaimer", "verificationSources", "lastVerifiedAt", "verificationStatus", "requiredDocuments"],
          additionalProperties: false,
        } } },
      }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new OpenAIRequestError(response.status, response.headers.get("retry-after")); }
    if (options.onDelta) return validateIntentAnalysis(JSON.parse(await readProviderStream(response, options.onDelta)), options);
    const payload = (await response.json()) as OpenAIResponse;
    const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!text) {
      console.warn("[Readiness AI] OpenAI response contained no structured intent output", {
        status: payload.status,
        outputItemTypes: payload.output?.flatMap((item) => [item.type, ...(item.content ?? []).map((content) => content.type)]).filter(Boolean),
      });
      throw new Error("OpenAI returned no structured intent output.");
    }
    return validateIntentAnalysis(JSON.parse(text), options);
  }
}


export class OpenAIRequestError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null = null) {
    super(`OpenAI intent request failed with status ${status}`);
  }
}


export class MissingAuthoritativeSourceError extends Error {
  constructor() {
    super("OpenAI returned a package without an authoritative source.");
  }
}


export function isRetryable(error: Error) {
  if (error instanceof OpenAIRequestError) {
    return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof MissingAuthoritativeSourceError) return true;
  // Retrying a locally aborted request simply repeats the full timeout window.
  // Retry transient connection failures, but return promptly after our deadline.
  return error.name !== "TimeoutError" && error.name !== "AbortError" && error instanceof TypeError;
}


export function readRequestTimeout() {
  const configured = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000 && configured <= MAX_REQUEST_TIMEOUT_MS
    ? configured
    : DEFAULT_REQUEST_TIMEOUT_MS;
}


export function safeErrorCause(cause: unknown) {
  if (!cause) return undefined;
  if (cause instanceof Error) return { name: cause.name, message: cause.message };
  if (typeof cause === "string" || typeof cause === "number" || typeof cause === "boolean") return cause;
  return String(cause);
}


export function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}


export function retryDelayMs(error: Error, attempt: number, deadline: number) {
  const retryAfter = error instanceof OpenAIRequestError ? parseRetryAfterMs(error.retryAfter) : null;
  const fallback = 1_000 * 2 ** (attempt - 1);
  return Math.min(Math.max(retryAfter ?? fallback, 250), Math.max(0, deadline - Date.now()));
}


export function parseRetryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}
