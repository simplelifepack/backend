import { prisma } from "../lib/prisma";
import { listActiveHealthReminders } from "./health.service";

function iso(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export async function getHealthHomeAttention(userId: string) {
  const medicationWindow = new Date();
  medicationWindow.setDate(medicationWindow.getDate() + 60);
  const [reminders, medications] = await Promise.all([
    listActiveHealthReminders(userId),
    prisma.healthMedication.findMany({
      where: {
        userId,
        status: "continuing",
        runsOutAt: { not: null, lte: medicationWindow },
      },
      include: {
        member: { select: { name: true } },
        sourceDocument: { select: { type: true } },
      },
      orderBy: { runsOutAt: "asc" },
      take: 20,
    }),
  ]);
  return {
    reminders,
    medications: medications.map((item) => ({
      id: item.id,
      eventType: "medication" as const,
      recordId: item.sourceDocumentId,
      occurredAt: iso(item.runsOutAt),
      title: item.name,
      detail: item.runsOutAt ? `Runs out ${iso(item.runsOutAt)}` : null,
      source: item.sourceDocument ? "Medication recorded" : "Manual medication",
      sourceType: item.sourceDocument?.type ?? "manual",
      memberId: item.memberId,
      memberName: item.member.name,
      medication: {
        name: item.name,
        dose: item.dose,
        frequency: item.frequency,
        whenToTake: item.whenToTake,
        mealTiming: item.mealTiming,
        duration: item.duration,
        quantity: item.quantity,
        repeats: item.repeats,
        repeatRunsOut: iso(item.repeatRunsOut),
        runsOutAt: iso(item.runsOutAt),
        status: item.status,
        stoppedAt: iso(item.stoppedAt),
      },
    })),
  };
}
