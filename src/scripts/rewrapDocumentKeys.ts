import { prisma } from "../lib/prisma";
import {
  KEY_ALGORITHM,
  getActiveDocumentEncryptionKey,
  rewrapDocumentAesKey,
} from "../services/documentHybridEncryption";

async function run() {
  const apply = process.argv.includes("--apply");
  const active = getActiveDocumentEncryptionKey();
  const documents = await prisma.document.findMany({
    where: {
      keyAlgorithm: KEY_ALGORITHM,
      wrappedKey: { not: null },
      OR: [
        { keyId: { not: active.keyId } },
        { keyVersion: { not: active.keyVersion } },
      ],
    },
    select: {
      id: true,
      keyId: true,
      keyVersion: true,
      wrappedKey: true,
    },
  });

  if (!apply) {
    console.log(
      `${documents.length} document key(s) would be rewrapped to ${active.keyId} v${active.keyVersion}. Run with --apply to update metadata.`,
    );
    return;
  }

  for (const document of documents) {
    if (!document.keyId || !document.keyVersion || !document.wrappedKey) continue;
    const rewrapped = rewrapDocumentAesKey({
      keyId: document.keyId,
      keyVersion: document.keyVersion,
      wrappedKey: document.wrappedKey,
    });
    await prisma.document.update({
      where: { id: document.id },
      data: rewrapped,
    });
  }
  console.log(
    `Rewrapped ${documents.length} document key(s) to ${active.keyId} v${active.keyVersion}. Ciphertext objects were not rewritten.`,
  );
}

void run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Document key rotation failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
