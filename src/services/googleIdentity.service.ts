import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { z } from "zod";

const credentialSchema = z.object({
  credential: z.string().trim().min(1, "Google credential is required."),
});

export type VerifiedGoogleIdentity = {
  subject: string;
  email: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
};

export type GoogleCredentialVerifier = (credential: string) => Promise<TokenPayload | undefined>;

class GoogleAuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = "GoogleAuthError";
    this.statusCode = statusCode;
  }
}

function getGoogleClientId() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new GoogleAuthError("Google sign-in is not configured.", 503);
  return clientId;
}

export async function verifyGoogleCredential(
  input: unknown,
  verifier?: GoogleCredentialVerifier,
): Promise<VerifiedGoogleIdentity> {
  const parsed = credentialSchema.safeParse(input);
  if (!parsed.success) throw new GoogleAuthError("Google credential is required.", 400);
  const { credential } = parsed.data;
  const audience = getGoogleClientId();

  let payload: TokenPayload | undefined;
  try {
    payload = verifier
      ? await verifier(credential)
      : (await new OAuth2Client(audience).verifyIdToken({ idToken: credential, audience })).getPayload();
  } catch {
    throw new GoogleAuthError("Invalid Google credential.");
  }

  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new GoogleAuthError("Invalid Google account.");
  }

  return {
    subject: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: payload.name?.trim() || undefined,
    givenName: payload.given_name?.trim() || undefined,
    familyName: payload.family_name?.trim() || undefined,
    picture: payload.picture?.trim() || undefined,
  };
}
