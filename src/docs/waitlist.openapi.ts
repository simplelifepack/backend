import type { Operation } from "./openapi";

const message = { type: "object", properties: { message: { type: "string" } }, required: ["message"] };
const response = (description: string, schema: Record<string, unknown>, examples?: Record<string, unknown>) => ({ description, content: { "application/json": { schema, ...(examples ? { examples } : {}) } } });
const error = (description: string) => response(description, { $ref: "#/components/schemas/ErrorResponse" });
const rateLimit = { ...error("Too many waitlist requests (60/IP/hour) or registrations (5/email/hour)."), headers: { "Retry-After": { description: "Wait time in seconds.", schema: { type: "integer", example: 3600 } } } };
const unavailable = error("Waitlist configuration is temporarily unavailable.");
const confirmation = { ...message, properties: { ...message.properties, alreadyRegistered: { type: "boolean", description: "False for a new registration; true when the normalized email is already stored. Omitted for honeypot responses." } } };

export const waitlistOperations: Operation[] = [
  {
    method: "get", path: "/api/waitlist/challenge", tags: ["Early Access"], summary: "Prepare early access registration", operationId: "waitlistChallenge", security: [],
    description: "Returns a signed, IP-bound challenge valid for ten minutes. Find a decimal nonce for which SHA-256(token + ':' + nonce) has twelve leading zero bits (first byte zero; second byte below 16). Submit the token and nonce as challenge and solution. Each challenge can be consumed once. The example is illustrative; obtain a fresh token before submission. Public and credential-free.",
    responses: { 200: response("Challenge", { type: "object", properties: { token: { type: "string", description: "Signed opaque token; do not alter it." }, difficulty: { type: "integer", enum: [12] } }, required: ["token", "difficulty"] }, { challenge: { summary: "Illustrative token; use a fresh API response", value: { token: "<fresh-signed-token>", difficulty: 12 } } }), 429: rateLimit, 503: unavailable },
  },
  {
    method: "post", path: "/api/waitlist/register", tags: ["Early Access"], summary: "Register for early access", operationId: "registerWaitlist", security: [],
    description: "Trims and lowercases email, then atomically inserts one encrypted registration. A new registration returns immediately after persistence; confirmation email runs in a Vercel-managed background task. Duplicates return a friendly message with alreadyRegistered=true and never resend email. Submitting an unsubscribed email does not restore consent. Requires a fresh challenge and proof of work. website is a honeypot and must be empty. Public and credential-free; no account/session is created. The example solution must be replaced with the nonce for your current challenge.",
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { email: { type: "string", format: "email", maxLength: 254 }, website: { type: "string", maxLength: 500, default: "" }, challenge: { type: "string", maxLength: 300 }, solution: { type: "string", maxLength: 7, pattern: "^[0-9]{1,7}$" } }, required: ["email", "challenge", "solution"] }, example: { email: "person@example.com", website: "", challenge: "<fresh-signed-token>", solution: "12345" } } } },
    responses: { 200: response("Registered or already registered; email delivery is tracked separately", confirmation, {
      registered: { summary: "New registration", value: { message: "You’re registered for early access. Thank you!", alreadyRegistered: false } },
      alreadyRegistered: { summary: "Duplicate email; no repeated confirmation", value: { message: "You’re already registered for early access. Thanks for your interest!", alreadyRegistered: true } },
    }), 400: error("Invalid email/payload, expired or invalid proof, or already-consumed challenge."), 429: rateLimit, 503: unavailable },
  },
  {
    method: "post", path: "/api/waitlist/unsubscribe", tags: ["Early Access"], summary: "Unsubscribe from early access", operationId: "unsubscribeWaitlist", security: [],
    description: "Idempotently suppresses early access email using the signed waitlistUnsubscribe token in the confirmation email link. Opening the link alone does not change consent; explicit POST confirmation is required. Repeated valid requests succeed. Public and credential-free; the signed token authorizes only this unsubscribe action.",
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { token: { type: "string", maxLength: 200 } }, required: ["token"] }, example: { token: "<token-from-confirmation-email>" } } } },
    responses: { 200: response("Unsubscribed", message, { unsubscribed: { value: { message: "You’ve been unsubscribed from early access emails." } } }), 400: error("Invalid unsubscribe link."), 429: rateLimit, 503: unavailable },
  },
];
