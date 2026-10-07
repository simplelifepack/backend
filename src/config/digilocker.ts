export type DigiLockerEnvironment = "sandbox" | "production";

export type DigiLockerConfig = {
  configured: boolean;
  environment: DigiLockerEnvironment;
  clientId: string | null;
  clientSecret: string | null;
  baseUrl: string;
  apiVersion: string;
};

export const SUPPORTED_DIGILOCKER_DOCUMENTS = ["AADHAAR", "PAN", "DRIVING_LICENSE"] as const;
export type SupportedDigiLockerDocument = typeof SUPPORTED_DIGILOCKER_DOCUMENTS[number];

export function loadDigiLockerConfig(env = process.env): DigiLockerConfig {
  const rawEnvironment = (env.CASHFREE_DIGILOCKER_ENVIRONMENT || "sandbox").toLowerCase();
  const environment: DigiLockerEnvironment = rawEnvironment === "production" ? "production" : "sandbox";
  const clientId = env.CASHFREE_DIGILOCKER_CLIENT_ID?.trim() || null;
  const clientSecret = env.CASHFREE_DIGILOCKER_CLIENT_SECRET?.trim() || null;
  return {
    configured: Boolean(clientId && clientSecret),
    environment,
    clientId,
    clientSecret,
    baseUrl: environment === "production" ? "https://api.cashfree.com/verification" : "https://sandbox.cashfree.com/verification",
    apiVersion: env.CASHFREE_DIGILOCKER_API_VERSION?.trim() || "2024-12-01",
  };
}

export function isSupportedDigiLockerDocument(value: string): value is SupportedDigiLockerDocument {
  return (SUPPORTED_DIGILOCKER_DOCUMENTS as readonly string[]).includes(value);
}
