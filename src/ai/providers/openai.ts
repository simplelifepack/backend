import type { AIReadinessPackage } from "../intentTypes";
import type { AIProvider } from "./types";
import { normalizeRequirementDocumentTypes } from "../../services/readiness/normalization";

type OpenAIResponse = { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };

const MAX_ATTEMPTS = 2;
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
        reasoning: { effort: "minimal" },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        instructions: [
          "LifePack is a readiness engine, not a chatbot.",
          "Convert the user's goal into exactly one practical readiness package.",
          "Return only the required JSON schema. Never return prose, markdown, advice, or suggested steps.",
          "List the documents commonly required for the user's jurisdiction and goal.",
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
          required: ["packageName", "category", "description", "requiredDocuments"],
          additionalProperties: false,
        } } },
      }),
    });
    if (!response.ok) throw new OpenAIRequestError(response.status);
    const payload = (await response.json()) as OpenAIResponse;
    const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!text) throw new Error("OpenAI returned no structured intent output.");
    return validateIntentAnalysis(JSON.parse(text));
  }
}

class OpenAIRequestError extends Error {
  constructor(readonly status: number) {
    super(`OpenAI intent request failed with status ${status}.`);
  }
}

function isRetryable(error: Error) {
  if (error instanceof OpenAIRequestError) {
    return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
  }
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
  return {
    packageName: result.packageName.trim().slice(0, 120),
    category: result.category.trim().slice(0, 60),
    description: result.description.trim().slice(0, 200),
    requiredDocuments: documents.map((item) => ({
      id: normalizeId(item.id), category: item.category.trim().slice(0, 60),
      documentType: normalizeRequirementDocumentTypes(item.documentType, item.title)[0]!, owner: item.owner,
      name: item.name.trim().slice(0, 100), title: item.title.trim().slice(0, 100), required: item.required,
    })).filter((item) => item.id && item.category && item.documentType && item.name && item.title).slice(0, 30),
  };
}

function isRequiredDocument(item: unknown): item is AIReadinessPackage["requiredDocuments"][number] {
  if (!item || typeof item !== "object") return false;
  const value = item as Record<string, unknown>;
  return typeof value.id === "string" && typeof value.category === "string" && typeof value.documentType === "string" && typeof value.owner === "string" && typeof value.name === "string" && typeof value.title === "string" && typeof value.required === "boolean";
}

function normalizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100);
}
