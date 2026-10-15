import { Router } from "express";

import { prisma } from "../../lib/prisma";
import { requireAdminAuth } from "../../middleware/adminAuth";
import { getActiveDocumentEncryptionKey } from "../../services/documentEncryptionKeyring";
import { pickDto } from "../../lib/sealedFields";

const router = Router();
router.use(requireAdminAuth);

type PostureCheck = { ok: boolean; label: string };

function postureChecks(activeKeyId: string | null): PostureCheck[] {
  const isProduction = process.env.NODE_ENV === "production";
  const checks: PostureCheck[] = [
    {
      ok: !isProduction || Boolean(process.env.TRUST_PROXY),
      label: isProduction
        ? (process.env.TRUST_PROXY ? "Proxy trust configured (TRUST_PROXY)" : "TRUST_PROXY is not set in production")
        : "Proxy trust (TRUST_PROXY) — not required outside production",
    },
    {
      ok: Boolean(process.env.DOCUMENT_MALWARE_SCANNER_COMMAND),
      label: process.env.DOCUMENT_MALWARE_SCANNER_COMMAND
        ? "External malware scanner configured"
        : "External malware scanner not configured: built-in checks only",
    },
    {
      ok: Boolean(process.env.DOCUMENT_RSA_ACTIVE_KEY_ID),
      label: process.env.DOCUMENT_RSA_ACTIVE_KEY_ID
        ? "Document RSA key comes from configured secrets"
        : "Document RSA key comes from the local dev fallback, not a managed secret",
    },
    {
      ok: !isProduction || activeKeyId !== "lifepack-development",
      label: activeKeyId === "lifepack-development"
        ? (isProduction ? "Development key ID is active in production" : "Using the local dev keypair (expected outside production)")
        : "No development key ID in use",
    },
  ];
  return checks;
}

router.get("/", async (_req, res, next) => {
  try {
    let activeKey: { keyId: string; keyVersion: number; algorithm: string } | null = null;
    try {
      const key = getActiveDocumentEncryptionKey();
      // getActiveDocumentEncryptionKey() returns the full keypair record
      // (privateKeyPem, publicKeyPem included) — pickDto makes the
      // omission explicit and typed rather than implicit in a hand-typed
      // object literal that a later edit could widen with `...key`.
      activeKey = pickDto(key, ["keyId", "keyVersion", "algorithm"]);
    } catch {
      activeKey = null;
    }

    const [byKey, envelopeCount, legacyCount, totalDocuments] = await Promise.all([
      prisma.document.groupBy({
        by: ["keyId", "keyVersion"],
        where: { deletedAt: null, keyId: { not: null } },
        _count: true,
        orderBy: { _count: { keyId: "desc" } },
      }),
      prisma.document.count({ where: { deletedAt: null, encryptionVersion: { not: null } } }),
      prisma.document.count({ where: { deletedAt: null, encryptionVersion: null } }),
      prisma.document.count({ where: { deletedAt: null } }),
    ]);

    const legacyKeyCount = await prisma.document.count({ where: { deletedAt: null, keyId: null } });

    return res.json({
      activeKey,
      keyDistribution: [
        ...byKey.map((row) => ({
          keyId: row.keyId, keyVersion: row.keyVersion, count: row._count,
          isActive: Boolean(activeKey && row.keyId === activeKey.keyId && row.keyVersion === activeKey.keyVersion),
        })),
        ...(legacyKeyCount > 0 ? [{ keyId: null, keyVersion: null, count: legacyKeyCount, isActive: false }] : []),
      ],
      encryptionType: { clientEnvelope: envelopeCount, legacyServerEncrypted: legacyCount },
      totalDocuments,
      posture: postureChecks(activeKey?.keyId ?? null),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
