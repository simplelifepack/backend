import type { AIReadinessPackage } from "./intentTypes";
import { createAIProvider } from "./providers";

export class AIUnavailableError extends Error {
  readonly statusCode = 503;

  constructor() {
    super("AI assistant unavailable");
    this.name = "AIUnavailableError";
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
    throw new AIUnavailableError();
  }
}
