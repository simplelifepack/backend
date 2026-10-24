import { z } from "zod";
import { prisma } from "../lib/prisma";

const submitFeedbackSchema = z.object({
  category: z.enum(["bug", "idea", "other"]),
  message: z.string().trim().min(3, "Tell us a bit more.").max(2000),
  platform: z.enum(["web", "ios", "android"]),
});

export async function submitFeedback(userId: string, email: string, input: unknown) {
  const { category, message, platform } = submitFeedbackSchema.parse(input);
  return prisma.feedback.create({
    data: { userId, email, category, message, platform },
    select: { id: true, createdAt: true },
  });
}
