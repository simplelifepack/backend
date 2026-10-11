import { loadBackendEnv } from "../config/env";
import { provisionPackagesAdminFromEnv } from "../services/adminPackages.service";

loadBackendEnv();

provisionPackagesAdminFromEnv()
  .then((user) => {
    console.info(`Provisioned packages admin account: ${user.email}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
