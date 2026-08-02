import type { AIReadinessPackage } from "../intentTypes";

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  analyzeIntent(query: string): Promise<AIReadinessPackage>;
}
