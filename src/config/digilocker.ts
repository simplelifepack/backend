export type DigiLockerEnvironment = "sandbox" | "production";

export type DigiLockerConfig = {
  configured: boolean;
  environment: DigiLockerEnvironment;
};

export const SUPPORTED_DIGILOCKER_DOCUMENTS = ["AADHAAR", "PAN", "DRIVING_LICENSE"] as const;
export type SupportedDigiLockerDocument = typeof SUPPORTED_DIGILOCKER_DOCUMENTS[number];

export function loadDigiLockerConfig(): DigiLockerConfig {
  return {
    configured: false,
    environment: "sandbox",
  };
}

export function isSupportedDigiLockerDocument(value: string): value is SupportedDigiLockerDocument {
  return (SUPPORTED_DIGILOCKER_DOCUMENTS as readonly string[]).includes(value);
}
