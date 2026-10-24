import type { AIReadinessPackage } from "../intentTypes";

export type ProviderRequestOptions = {
  allowUnverifiedGuidance?: boolean;
  signal?: AbortSignal;
  beforeRequest?: () => Promise<void | (() => Promise<void>)>;
  onDelta?: (text: string) => void;
  onRetry?: (event: { attempt: number; delayMs: number; status?: number }) => void | Promise<void>;
  /** AI operations & prompts (D7): overrides the provider's own baked-in
   * model/instructions for this one call, sourced from AITaskConfig by the
   * caller (analyzeIntent.ts). Omitted entirely falls back to the
   * provider's own hardcoded default, same as before this existed. */
  model?: string;
  instructionsOverride?: string[];
};

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  analyzeIntent(query: string, options?: ProviderRequestOptions): Promise<AIReadinessPackage>;
}
