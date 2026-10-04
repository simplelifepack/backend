import { Prisma } from "@prisma/client";

export const activeRequirementsWhere: Prisma.RequirementWhereInput = {
  OR: [{ metadata: { equals: Prisma.DbNull } }, { metadata: { path: ["refreshRetired"], equals: Prisma.AnyNull } }, { NOT: { metadata: { path: ["refreshRetired"], equals: true } } }],
};
