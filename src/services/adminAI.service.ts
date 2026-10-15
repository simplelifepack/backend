import { prisma } from "../lib/prisma";
import { withAudit } from "./adminAudit.service";
import { TASK_KEYS, getMonthToDateSpendUsd, type PromptConfig, type TaskKey } from "./aiTaskConfig.service";
import { OpenAIProvider } from "../ai/providers/openai";

export class AdminAIError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AdminAIError";
    this.statusCode = statusCode;
  }
}

type AdminCtx = { adminId: string; actorEmail: string };

export function isTaskKey(value: string): value is TaskKey {
  return (TASK_KEYS as readonly string[]).includes(value);
}

export async function listTaskConfigs() {
  const [configs, budgets] = await Promise.all([
    prisma.aITaskConfig.findMany({ orderBy: { taskKey: "asc" } }),
    prisma.aIBudget.findMany(),
  ]);
  const budgetByTask = new Map(budgets.map((b) => [b.taskKey, b]));
  const configuredKeys = new Set(configs.map((c) => c.taskKey));

  const rows = await Promise.all(TASK_KEYS.map(async (taskKey) => {
    const config = configs.find((c) => c.taskKey === taskKey) ?? null;
    const budget = budgetByTask.get(taskKey) ?? null;
    const monthToDateUsd = await getMonthToDateSpendUsd(taskKey);
    return {
      taskKey,
      configured: configuredKeys.has(taskKey), // false until the task's first real run seeds it
      primaryModel: config?.primaryModel ?? null,
      fallbackModel: config?.fallbackModel ?? null,
      version: config?.version ?? 0,
      updatedAt: config?.updatedAt ?? null,
      monthToDateUsd,
      monthlyCapUsd: budget ? Number(budget.monthlyCapUsd) : null,
    };
  }));
  return rows;
}

export async function getTaskConfigDetail(taskKey: string) {
  if (!isTaskKey(taskKey)) throw new AdminAIError("Unknown AI task.", 404);
  const [config, revisions, budget, recentLogs] = await Promise.all([
    prisma.aITaskConfig.findUnique({ where: { taskKey } }),
    prisma.promptRevision.findMany({ where: { taskKey }, orderBy: { version: "desc" }, take: 20, include: { publishedBy: { select: { name: true, email: true } } } }),
    prisma.aIBudget.findUnique({ where: { taskKey } }),
    prisma.aIRequestLog.findMany({ where: { taskKey }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  if (!config) throw new AdminAIError("This task hasn't run yet — its config seeds on first real use.", 404);
  const monthToDateUsd = await getMonthToDateSpendUsd(taskKey);
  return { config, revisions, budget, recentLogs, monthToDateUsd };
}

export async function publishTaskConfig(ctx: AdminCtx, taskKey: string, input: {
  primaryModel: string; fallbackModel?: string | null; promptConfig: PromptConfig; testResult?: unknown;
}, reason: string) {
  if (!isTaskKey(taskKey)) throw new AdminAIError("Unknown AI task.", 404);
  const existing = await prisma.aITaskConfig.findUnique({ where: { taskKey } });
  if (!existing) throw new AdminAIError("This task hasn't run yet — its config seeds on first real use. Nothing to publish over yet.", 404);

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "ai.prompt.publish",
      targetType: "AITaskConfig", targetId: taskKey, reason,
      diff: { from: { primaryModel: existing.primaryModel, promptConfig: existing.promptConfig }, to: { primaryModel: input.primaryModel, promptConfig: input.promptConfig } },
    },
    async (tx) => {
      const nextVersion = existing.version + 1;
      const updated = await tx.aITaskConfig.update({
        where: { taskKey },
        data: {
          primaryModel: input.primaryModel, fallbackModel: input.fallbackModel ?? null,
          promptConfig: input.promptConfig as object, version: nextVersion, updatedByAdminId: ctx.adminId,
        },
      });
      await tx.promptRevision.create({
        data: {
          taskKey, version: nextVersion, primaryModel: input.primaryModel, fallbackModel: input.fallbackModel ?? null,
          promptConfig: input.promptConfig as object, testResult: (input.testResult ?? undefined) as object | undefined,
          publishedByAdminId: ctx.adminId,
        },
      });
      return updated;
    },
  );
}

const SAMPLE_PACKAGE_INTENT_QUERY = JSON.stringify({ packageType: "Driving license renewal", documentLabels: [], country: "US", state: "California" });

/** Only `package_intent` gets a real test-before-publish sandbox: it's the
 * one task whose input is plain text, no file bytes or multi-step research
 * pipeline to fake safely. The other three tasks publish directly — a
 * scoping decision, not an oversight (see the tracker). This makes a real,
 * billed OpenAI call on purpose: the whole point is showing the admin what
 * the *actual* model does with the *actual* draft prompt before it goes
 * live, which a mocked response can't do. */
export async function testTaskConfig(taskKey: string, draft: { primaryModel: string; promptConfig: PromptConfig }) {
  if (taskKey !== "package_intent") {
    throw new AdminAIError("Test-before-publish is only available for Package intent — the other tasks publish directly.", 400);
  }
  if (draft.promptConfig.kind !== "array") throw new AdminAIError("Package intent's prompt must be the instructions-array shape.", 400);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new AdminAIError("OPENAI_API_KEY is not configured in this environment.", 503);

  const startedAt = Date.now();
  try {
    const provider = new OpenAIProvider(apiKey, draft.primaryModel);
    const result = await provider.analyzeIntent(SAMPLE_PACKAGE_INTENT_QUERY, {
      instructionsOverride: draft.promptConfig.items,
      allowUnverifiedGuidance: true,
    });
    return { success: true as const, durationMs: Date.now() - startedAt, sampleQuery: SAMPLE_PACKAGE_INTENT_QUERY, output: result };
  } catch (error) {
    return { success: false as const, durationMs: Date.now() - startedAt, sampleQuery: SAMPLE_PACKAGE_INTENT_QUERY, error: error instanceof Error ? error.message : "Test call failed." };
  }
}

export async function upsertBudget(ctx: AdminCtx, taskKey: string, monthlyCapUsd: number, reason: string) {
  if (!isTaskKey(taskKey)) throw new AdminAIError("Unknown AI task.", 404);
  const existing = await prisma.aIBudget.findUnique({ where: { taskKey } });

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: existing ? "ai.budget.update" : "ai.budget.create",
      targetType: "AIBudget", targetId: taskKey, reason, diff: { from: existing ? Number(existing.monthlyCapUsd) : null, to: monthlyCapUsd },
    },
    (tx) => tx.aIBudget.upsert({
      where: { taskKey },
      create: { taskKey, monthlyCapUsd, updatedByAdminId: ctx.adminId },
      update: { monthlyCapUsd, updatedByAdminId: ctx.adminId },
    }),
  );
}
