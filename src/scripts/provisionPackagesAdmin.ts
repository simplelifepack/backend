import { loadBackendEnv } from "../config/env";
import { provisionPackagesAdminFromEnv } from "../services/adminPackages.service";

loadBackendEnv();

provisionPackagesAdminFromEnv({ rotateExisting: process.argv.includes("--rotate-password") })
  .then((_user) => {
    console.info("Provisioned packages admin account.");
  })
  .catch((error) => {
    console.error("Admin provisioning failed.");
    process.exitCode = 1;
  });
