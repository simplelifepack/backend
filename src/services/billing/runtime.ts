import { prisma } from "../../lib/prisma";
import { BillingService } from "./service";
export const billingService = new BillingService(prisma);
