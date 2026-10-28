import { prisma } from "../lib/prisma";
import { main } from "./defaultPackageImport";

main()
  .catch(() => {
    console.error("[Default Packages Import] failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
