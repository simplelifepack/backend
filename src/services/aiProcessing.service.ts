import { prisma } from "../lib/prisma";

export class AIProcessingDisabledError extends Error {
  readonly statusCode = 403;
  readonly code = "AI_PROCESSING_DISABLED";

  constructor() {
    super("AI processing is disabled for this account.");
    this.name = "AIProcessingDisabledError";
  }
}

export async function assertAIProcessingEnabled(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiProcessingEnabled: true },
  });
  if (!user || !user.aiProcessingEnabled) throw new AIProcessingDisabledError();
}
