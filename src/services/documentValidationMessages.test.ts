import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentEnvelopeError, validateEncryptedDocumentEnvelope } from './documentEnvelopeValidation';
import { buildErrorResponse } from '../middleware/errorHandling';

test('upload errors are distinct and safe in development and production', () => {
  for (const production of [true, false]) {
    for (const [code, message] of [
      ['FILE_CORRUPTED', 'This file appears to be corrupted. Please try uploading another copy.'],
      ['UNSUPPORTED_FILE_TYPE', 'This file type isn’t supported. Please upload a JPEG, PNG, WebP, or PDF.'],
      ['FILE_TOO_LARGE', 'File is too large. Please upload a file no larger than 20 MB.'],
    ]) {
      const response = buildErrorResponse({ error: new DocumentEnvelopeError(code!, 'truncated decoder byte validation details', 422), production });
      assert.equal(response.body.code, code);
      assert.equal(response.body.message, message);
    }
    const response = buildErrorResponse({ error: Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' }), production });
    assert.equal(response.status, 413);
    assert.equal(response.body.code, 'FILE_TOO_LARGE');
    assert.match(response.body.message, /20 MB/);
  }
});

test('invalid metadata size and unsupported format do not become encryption or corruption errors', () => {
  const file = { fieldname: 'encryptedFile', mimetype: 'application/octet-stream', size: 30 } as Express.Multer.File;
  assert.throws(() => validateEncryptedDocumentEnvelope({ originalSize: 20 * 1024 * 1024 + 1 }, file), { code: 'FILE_TOO_LARGE', statusCode: 413 });
  assert.throws(() => validateEncryptedDocumentEnvelope({ originalSize: 10, originalMimeType: 'image/gif' }, file), { code: 'UNSUPPORTED_FILE_TYPE', statusCode: 415 });
});
