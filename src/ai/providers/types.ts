import type { AIReadinessPackage } from "../intentTypes";

export type ProviderRequestOptions = {
  allowUnverifiedGuidance?: boolean;
  signal?: AbortSignal;
  beforeRequest?: () => Promise<void | (() => Promise<void>)>;
  onDelta?: (text: string) => void;
  onRetry?: (event: { attempt: number; delayMs: number; status?: number }) => void | Promise<void>;
};

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  analyzeIntent(query: string, options?: ProviderRequestOptions): Promise<AIReadinessPackage>;
}
