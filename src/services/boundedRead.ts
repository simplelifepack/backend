import { Readable } from "node:stream";

export async function readBoundedBytes(input: AsyncIterable<Uint8Array> | ArrayBuffer | Buffer, maximum: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    const source = input instanceof ArrayBuffer ? [Buffer.from(input)] : Buffer.isBuffer(input) ? [input] : input;
    for await (const chunk of source) {
      size += chunk.byteLength;
      if (size > maximum) throw Object.assign(new Error("Provider document exceeds the file size limit."), { statusCode: 413 });
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, size);
  } finally {
    chunks.length = 0;
    if (input instanceof Readable && !input.destroyed) input.destroy();
  }
}
