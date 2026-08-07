import type { AIReadinessPackage } from "./intentTypes";
import { createAIProvider } from "./providers";

export class AIUnavailableError extends Error {
  readonly statusCode = 503;

  constructor() {
    super("AI assistant unavailable");
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

export async function analyzeIntent(query: string): Promise<AIReadinessPackage> {
  const selection = createAIProvider();
  console.info(`[LifePack AI]\nProvider: ${selection.providerName}\nModel: ${selection.model ?? "none"}\nReason: ${selection.reason}`);
  if (!selection.provider) throw new AIUnavailableError();

  try {
    return await selection.provider.analyzeIntent(query);
  } catch (error) {
    console.error("[LifePack AI] Provider request failed", { provider: selection.providerName, model: selection.model, message: error instanceof Error ? error.message : "Unknown provider error" });
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
