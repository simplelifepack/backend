import { buildPackageInput } from "./packageInput";
import { consumeAIAction, releaseUninvokedAIAction, UsageLimitError } from "../services/accountUsage.service";
import type { ProviderRequestOptions } from "./providers/types";
import type { AIReadinessPackage } from "./intentTypes";
import { createAIProvider } from "./providers";

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

export async function analyzeIntent(userId: string, input: unknown, options: Pick<ProviderRequestOptions, "signal" | "onDelta"> = {}): Promise<AIReadinessPackage> {
  const query = JSON.stringify(buildPackageInput(input));
  const selection = createAIProvider();
  console.info(`[Readiness AI]\nProvider: ${selection.providerName}\nModel: ${selection.model ?? "none"}\nReason: ${selection.reason}`);
  if (!selection.provider) throw new AIUnavailableError();

  try {
    return await selection.provider.analyzeIntent(query, {
      ...options,
      beforeRequest: async () => {
        const period = await consumeAIAction(userId, undefined, options.signal);
        return period ? () => releaseUninvokedAIAction(userId, period) : undefined;
      },
    });
  } catch (error) {
    if (error instanceof UsageLimitError || options.signal?.aborted) throw error;
    console.error("[Readiness AI] Provider request failed", { provider: selection.providerName, model: selection.model, status: (error as { status?: number })?.status });
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
