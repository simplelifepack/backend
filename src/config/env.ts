import dotenv from "dotenv";
import path from "path";

export function loadBackendEnv() {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
}
