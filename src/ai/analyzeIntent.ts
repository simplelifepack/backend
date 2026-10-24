import { buildPackageInput } from "./packageInput";
import { consumeAIAction, releaseUninvokedAIAction, UsageLimitError } from "../services/accountUsage.service";
import type { ProviderRequestOptions } from "./providers/types";
import type { AIReadinessPackage } from "./intentTypes";
import { createAIProvider } from "./providers";
import { DEFAULT_PACKAGE_INTENT_INSTRUCTIONS } from "./providers/openai";
import { assertAIProcessingEnabled } from "../services/aiProcessing.service";
import { getTaskConfig, recordAIRequest } from "../services/aiTaskConfig.service";

export class AIUnavailableError extends Error {
  readonly statusCode = 503;

  constructor() {
    super("Package search unavailable");
    this.name = "AIUnavailableError";
  }
}

export class PackageGenerationRejectedError extends Error {
  readonly statusCode = 422;

  constructor() {
    super("No official source found for this package request. Try a more specific package name.");
    this.name = "PackageGenerationRejectedError";
  }
}

export async function analyzeIntent(userId: string, input: unknown, options: Pick<ProviderRequestOptions, "allowUnverifiedGuidance" | "signal" | "onDelta" | "onRetry"> = {}): Promise<AIReadinessPackage> {
  const query = JSON.stringify(buildPackageInput(input));
  await assertAIProcessingEnabled(userId);
  const selection = createAIProvider();
  console.info(`[Readiness AI]\nProvider: ${selection.providerName}\nModel: ${selection.model ?? "none"}\nReason: ${selection.reason}`);
  if (!selection.provider) throw new AIUnavailableError();

  const config = await getTaskConfig("package_intent", {
    primaryModel: selection.model ?? process.env.OPENAI_REQUIREMENTS_MODEL ?? process.env.OPENAI_INTENT_MODEL ?? "gpt-5.4-mini",
    promptConfig: { kind: "array", items: DEFAULT_PACKAGE_INTENT_INSTRUCTIONS },
  });
  const model = selection.providerName === "OpenAIProvider" ? config.primaryModel : (selection.model ?? undefined);
  const instructionsOverride = config.promptConfig.kind === "array" ? config.promptConfig.items : undefined;
  const startedAt = Date.now();

  try {
    const result = await selection.provider.analyzeIntent(query, {
      ...options,
      model,
      instructionsOverride,
      beforeRequest: async () => {
        const period = await consumeAIAction(userId, undefined, options.signal);
        return period ? () => releaseUninvokedAIAction(userId, period) : undefined;
      },
    });
    // No token-usage figures here — this call can retry and stream inside
    // the provider, so there's no single "the response" to read usage off
    // of the way the two single-shot tasks do. Logged for pass/fail and
    // spend-cap *alerting* purposes; cost stays null for this task (see the
    // tracker) rather than estimated from a number that isn't real.
    void recordAIRequest({ taskKey: "package_intent", userId, model: model ?? selection.model ?? "unknown", success: true, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    if (error instanceof UsageLimitError || options.signal?.aborted) throw error;
    console.error("[Readiness AI] Provider request failed", { provider: selection.providerName, model: selection.model, status: (error as { status?: number })?.status });
    void recordAIRequest({ taskKey: "package_intent", userId, model: model ?? selection.model ?? "unknown", success: false, errorCode: error instanceof Error ? error.name : "unknown", durationMs: Date.now() - startedAt });
    if (isPackageGenerationRejected(error)) {
      throw new PackageGenerationRejectedError();
    }
    throw new AIUnavailableError();
  }
}

function isPackageGenerationRejected(error: unknown) {
  if (!(error instanceof Error)) return false;
  return [
    "Invalid readiness package output.",
    "Readiness package contains no required documents.",
    "OpenAI returned no structured intent output.",
    "OpenAI returned a package without an authoritative source.",
  ].includes(error.message);
}
