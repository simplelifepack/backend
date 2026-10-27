import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import express, { type ErrorRequestHandler } from 'express';
import { encryptedUpload } from './upload';
import { currentPrivateUserId, withPrivateUser } from '../privacy/access';

test('chunked multipart uploads retain isolated authenticated context on success and failure', async () => {
  const app = express();
  app.use((req, _res, next) => withPrivateUser(String(req.headers['x-test-user']), next));
  app.post('/', encryptedUpload.array('encryptedFiles', 50), (req, res) => {
    assert.equal(currentPrivateUserId(), req.headers['x-test-user']);
    res.json({ user: currentPrivateUserId(), files: (req.files as Express.Multer.File[]).length });
  });
  const errors: ErrorRequestHandler = (_error, req, res, _next) => {
    assert.equal(currentPrivateUserId(), req.headers['x-test-user']);
    res.status(400).json({ user: currentPrivateUserId() });
  };
  app.use(errors);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const upload = (user: string, valid: boolean) => new Promise<void>((resolve, reject) => {
    const boundary = 'readines-context-test';
    const request = http.request({ host: '127.0.0.1', port, method: 'POST', headers: {
      'x-test-user': user, 'content-type': `multipart/form-data; boundary=${boundary}`,
    } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, valid ? 200 : 400);
          const result = JSON.parse(body);
          assert.equal(result.user, user);
          if (valid) assert.equal(result.files, 1);
          resolve();
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.write(`--${boundary}\r\nContent-Disposition: form-data; name="encryptedFiles"; filename="page.readines"\r\nContent-Type: ${valid ? 'application/octet-stream' : 'text/plain'}\r\n\r\n`);
    if (!valid) {
      request.end(`invalid\r\n--${boundary}--\r\n`);
      return;
    }
    let remaining = 3 * 1024 * 1024;
    const write = () => {
      const bytes = Math.min(remaining, 64 * 1024);
      request.write(Buffer.alloc(bytes, 17)); remaining -= bytes;
      if (remaining > 0) setImmediate(write);
      else request.end(`\r\n--${boundary}--\r\n`);
    };
    setImmediate(write);
  });
  try { await Promise.all([upload('user-a', true), upload('user-b', true), upload('user-c', false)]); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
