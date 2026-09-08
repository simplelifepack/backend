import type { AIReadinessPackage } from "../intentTypes";

export type ProviderRequestOptions = { signal?: AbortSignal; beforeRequest?: () => Promise<void | (() => Promise<void>)>; onDelta?: (text: string) => void };

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  analyzeIntent(query: string, options?: ProviderRequestOptions): Promise<AIReadinessPackage>;
}
