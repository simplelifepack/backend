import type { AIProvider } from "./types";
import { MockAIProvider } from "./mock";
import { OpenAIProvider } from "./openai";

export type AIProviderSelection = {
  provider: AIProvider | null;
  providerName: "OpenAIProvider" | "MockAIProvider" | "Disabled";
  model: string | null;
  reason: "configured" | "explicit_mock" | "missing_openai_api_key";
};

export function createAIProvider(): AIProviderSelection {
  const override = process.env.LIFEPACK_AI_PROVIDER?.trim().toLowerCase();
  if (override === "mock" && process.env.NODE_ENV !== "production") {
    const provider = new MockAIProvider();
    return { provider, providerName: "MockAIProvider", model: provider.model, reason: "explicit_mock" };
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey) {
    const provider = new OpenAIProvider(apiKey);
    return { provider, providerName: "OpenAIProvider", model: provider.model, reason: "configured" };
  }
  return { provider: null, providerName: "Disabled", model: null, reason: "missing_openai_api_key" };
}

export { MockAIProvider, OpenAIProvider };
export type { AIProvider } from "./types";
