import { loadDigiLockerConfig, type DigiLockerConfig, type SupportedDigiLockerDocument } from "../../config/digilocker";

export class DigiLockerDisabledError extends Error {
  statusCode = 503;
  code = "DIGILOCKER_NOT_CONFIGURED";

  constructor() {
    super("DigiLocker integration is coming soon.");
  }
}

export class CashfreeDigiLockerError extends Error {
  statusCode: number;
  code = "DIGILOCKER_PROVIDER_ERROR";

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type CashfreeDigiLockerClient = {
  createUrl(input: {
    verificationId: string;
    documentRequested: SupportedDigiLockerDocument[];
    redirectUrl: string;
  }): Promise<{ referenceId: string | null; url: string; status: string }>;
  getStatus(input: { verificationId: string; referenceId?: string | null }): Promise<{ status: string; referenceId: string | null; raw: unknown }>;
  getDocument(input: { verificationId: string; referenceId?: string | null; documentType: SupportedDigiLockerDocument }): Promise<unknown>;
};

type FetchLike = typeof fetch;

function cashfreeHeaders(config: DigiLockerConfig) {
  if (!config.configured || !config.clientId || !config.clientSecret) throw new DigiLockerDisabledError();
  return {
    "Content-Type": "application/json",
    "x-client-id": config.clientId,
    "x-client-secret": config.clientSecret,
    "x-api-version": config.apiVersion,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

async function parseResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  const record = asRecord(data);
  const message = stringValue(record.message) ?? stringValue(record.code) ?? "Cashfree DigiLocker request failed.";
  throw new CashfreeDigiLockerError(message, response.status);
}

export function createCashfreeDigiLockerClient(config = loadDigiLockerConfig(), fetchImpl: FetchLike = fetch): CashfreeDigiLockerClient {
  return {
    async createUrl(input) {
      const data = asRecord(await parseResponse(await fetchImpl(`${config.baseUrl}/digilocker`, {
        method: "POST",
        headers: cashfreeHeaders(config),
        body: JSON.stringify({
          verification_id: input.verificationId,
          document_requested: input.documentRequested,
          redirect_url: input.redirectUrl,
          user_flow: "document_import",
        }),
      })));
      const url = stringValue(data.url);
      if (!url) throw new CashfreeDigiLockerError("Cashfree did not return a DigiLocker consent URL.", 502);
      return {
        referenceId: stringValue(data.reference_id),
        url,
        status: stringValue(data.status) ?? "PENDING",
      };
    },
    async getStatus(input) {
      const query = new URLSearchParams();
      query.set("verification_id", input.verificationId);
      if (input.referenceId) query.set("reference_id", input.referenceId);
      const data = asRecord(await parseResponse(await fetchImpl(`${config.baseUrl}/digilocker?${query.toString()}`, {
        headers: cashfreeHeaders(config),
      })));
      return {
        status: stringValue(data.status) ?? "PENDING",
        referenceId: stringValue(data.reference_id),
        raw: data,
      };
    },
    async getDocument(input) {
      const query = new URLSearchParams();
      query.set("verification_id", input.verificationId);
      if (input.referenceId) query.set("reference_id", input.referenceId);
      return parseResponse(await fetchImpl(`${config.baseUrl}/digilocker/document/${encodeURIComponent(input.documentType)}?${query.toString()}`, {
        headers: cashfreeHeaders(config),
      }));
    },
  };
}
