const entries = new Map<string, { authVersion: number; expiresAt: number }>();

const DEFAULT_TTL_SECONDS = 5 * 60;

function ttlMs() {
  const configured = Number(process.env.AUTH_REVOCATION_CACHE_TTL_SECONDS);
  const seconds = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_SECONDS;
  return seconds * 1000;
}

export function noteAuthVersion(userId: string, authVersion: number) {
  entries.set(userId, {
    authVersion,
    expiresAt: Date.now() + ttlMs(),
  });
}

export function getNotedAuthVersion(userId: string) {
  const entry = entries.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(userId);
    return null;
  }
  return entry.authVersion;
}

export function clearAuthRevocationCacheForTests() {
  entries.clear();
}
