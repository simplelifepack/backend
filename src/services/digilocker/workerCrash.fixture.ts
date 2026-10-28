import { runDigiLockerWorker } from "./worker";
// Child process for the disposable-database crash test; never a provider client.
const url = process.env.DIGILOCKER_TEST_DATABASE_URL ?? "";
if (!process.send || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/readines_integration(?:\?|$)/.test(url)) {
  throw new Error("Disposable crash fixture requires IPC and the isolated test database");
}
global.fetch = async (_input, init) => {
  process.send?.({ event: "download-started" });
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
};
void runDigiLockerWorker()
  .then(() => process.exit(0)).catch(() => process.exit(1));
