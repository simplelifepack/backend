import { prisma } from "../lib/prisma";
import { evaluateBudgetAlert } from "./alerting.service";

export const TASK_KEYS = ["document_classification", "health_extraction", "package_intent", "research_refresh"] as const;
export type TaskKey = (typeof TASK_KEYS)[number];

export type PromptConfig =
  | { kind: "string"; text: string }
  | { kind: "array"; items: string[] }
  /** For a task with more than one named prompt component (research_refresh
   * has a "discovery" search prompt and a separate extraction prompt) —
   * `parts` need not cover every component the task actually uses; a part
   * a call site doesn't read from here just stays a hardcoded code
   * constant, same as before this system existed. See researchPackageRefresh
   * .ts for a part that's deliberately excluded because it's tightly
   * coupled to a code-level validator's exact wording/thresholds. */
  | { kind: "multi"; parts: Record<string, string> };

export type TaskDefault = { primaryModel: string; fallbackModel?: string; promptConfig: PromptConfig };

/** Approximate $/1M tokens (input, output), for budget *estimates* only —
 * not billing-accurate, and intentionally not fetched from a live pricing
 * API (one more external dependency on a hot path for a number nobody acts
 * on in real time). Unknown models fall back to a conservative placeholder
 * rather than silently recording $0, which would make a budget look safe
 * when it's actually untracked. */
const PRICE_PER_MILLION_TOKENS: Record<string, { in: number; out: number }> = {
  "gpt-5-mini": { in: 0.25, out: 2.0 },
  "gpt-5.4-mini": { in: 0.25, out: 2.0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10.0 },
};
const FALLBACK_PRICE = { in: 1.0, out: 4.0 };

export function estimateCostUsd(model: string, tokensIn?: number | null, tokensOut?: number | null): number | null {
  if (tokensIn == null && tokensOut == null) return null;
  const price = PRICE_PER_MILLION_TOKENS[model] ?? FALLBACK_PRICE;
  return ((tokensIn ?? 0) * price.in + (tokensOut ?? 0) * price.out) / 1_000_000;
}

/** Lazily seeds `AITaskConfig` from the call site's own current hardcoded
 * prompt/model the first time this runs after the feature ships (same
 * pattern as `wealthForm.service.ts`'s `ensureWealthCatalog()`) — never
 * built with placeholder content, and a task that's never been read keeps
 * behaving exactly as it did in code, byte for byte, until an admin
 * actually opens it. Every call site keeps its own hardcoded default as a
 * fallback if the DB is unreachable — same defense-in-depth as every other
 * DB-backed-with-code-fallback system this build has used. */
export async function getTaskConfig(taskKey: TaskKey, fallback: TaskDefault): Promise<TaskDefault> {
  try {
    const existing = await prisma.aITaskConfig.findUnique({ where: { taskKey } });
    if (existing) {
      return {
        primaryModel: existing.primaryModel,
        fallbackModel: existing.fallbackModel ?? undefined,
        promptConfig: existing.promptConfig as unknown as PromptConfig,
      };
    }
    await prisma.aITaskConfig.create({
      data: {
        taskKey, primaryModel: fallback.primaryModel, fallbackModel: fallback.fallbackModel ?? null,
        promptConfig: fallback.promptConfig as object,
      },
    });
    return fallback;
  } catch (error) {
    console.error({ event: "ai_task_config_read_failed", taskKey, errorCode: error instanceof Error ? error.name : "unknown" });
    return fallback;
  }
}

/** Awaited but never allowed to throw into a live AI call path — logging an
 * AI request is observability, not a precondition for the request having
 * happened. Fire-and-log, not fire-and-block. */
export async function recordAIRequest(entry: {
  taskKey: TaskKey; userId?: string | null; model: string; success: boolean; errorCode?: string | null;
  tokensIn?: number | null; tokensOut?: number | null; durationMs?: number | null;
  targetType?: string | null; targetId?: string | null;
}) {
  try {
    await prisma.aIRequestLog.create({
      data: {
        taskKey: entry.taskKey, userId: entry.userId ?? null, model: entry.model, success: entry.success,
        errorCode: entry.errorCode ?? null, tokensIn: entry.tokensIn ?? null, tokensOut: entry.tokensOut ?? null,
        costUsd: estimateCostUsd(entry.model, entry.tokensIn, entry.tokensOut),
        durationMs: entry.durationMs ?? null, targetType: entry.targetType ?? null, targetId: entry.targetId ?? null,
      },
    });
  } catch (error) {
    console.error({ event: "ai_request_log_write_failed", taskKey: entry.taskKey, errorCode: error instanceof Error ? error.name : "unknown" });
  }
  // Fire-and-forget: a budget check is an operational nice-to-have, not
  // something a live AI call should ever wait on or fail because of.
  void checkBudget(entry.taskKey).catch(() => undefined);
}

export async function getMonthToDateSpendUsd(taskKey: TaskKey) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const result = await prisma.aIRequestLog.aggregate({
    where: { taskKey, createdAt: { gte: monthStart } },
    _sum: { costUsd: true },
  });
  return Number(result._sum.costUsd ?? 0);
}

async function checkBudget(taskKey: TaskKey) {
  const budget = await prisma.aIBudget.findUnique({ where: { taskKey } });
  if (!budget) return;
  const spend = await getMonthToDateSpendUsd(taskKey);
  if (spend > Number(budget.monthlyCapUsd)) {
    await evaluateBudgetAlert(taskKey, spend, Number(budget.monthlyCapUsd));
  }
}
