import assert from "node:assert/strict";
import type { drive_v3 } from "googleapis";

import { listDrivePdfs } from "./scanner";

async function main() {
  const calls: drive_v3.Params$Resource$Files$List[] = [];
  const drive = {
    files: {
      list: async (params: drive_v3.Params$Resource$Files$List) => {
        calls.push(params);
        return {
          data: calls.length === 1
            ? {
                nextPageToken: "page-2",
                files: [
                  { id: "pdf-1", name: "passport.pdf", mimeType: "application/pdf", modifiedTime: "2026-07-20T10:00:00.000Z", md5Checksum: "abc", size: "42" },
                  { id: "image", name: "photo.png", mimeType: "image/png", modifiedTime: "2026-07-20T10:00:00.000Z" },
                ],
              }
            : {
                files: [{ id: "pdf-2", name: "salary.pdf", mimeType: "application/pdf", modifiedTime: "2026-07-21T10:00:00.000Z", size: "84" }],
              },
        };
      },
    },
  } as unknown as drive_v3.Drive;
  const checkpoint = new Date("2026-07-19T00:00:00.000Z");
  const files = await listDrivePdfs(drive, checkpoint);
  assert.deepEqual(files.map((file) => file.id), ["pdf-1", "pdf-2"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].pageToken, "page-2");
  assert.match(calls[0].q ?? "", /mimeType = 'application\/pdf'/);
  assert.match(calls[0].q ?? "", /modifiedTime > '2026-07-19T00:00:00.000Z'/);
  assert.equal(calls[0].fields, "nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size,webViewLink)");
  calls.length = 0;
  await listDrivePdfs(drive, null);
  assert.match(calls[0].q ?? "", /mimeType = 'application\/pdf'/);
  assert.match(calls[0].q ?? "", /trashed = false/);
  assert.doesNotMatch(calls[0].q ?? "", /modifiedTime >/);
  console.log("Google Drive pagination and PDF-only discovery tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
