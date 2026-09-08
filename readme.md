# Readiness local setup

## Services and database

```bash
cd be
docker compose up -d
npm install
npm run prisma:migrate
npm run dev
```

In a second terminal:

```bash
cd fe
npm install
npm run dev
```

The default frontend is `http://localhost:5173` and the backend is `http://localhost:4000`.

## Backend environment setup

The tracked `.env.example` contains only the variables required for the normal
local backend. Copy it once; keep real credentials only in the ignored `.env`:

```bash
cd be
cp .env.example .env
```

### 1. Database

For the included local PostgreSQL container, keep the example `DATABASE_URL`.
Start PostgreSQL and apply migrations:

```bash
docker compose up -d
npm run prisma:generate
npm run prisma:migrate
```

To use Supabase instead, replace only `DATABASE_URL` with the PostgreSQL URI
shown under Supabase **Project Settings -> Database -> Connection string**.
Use the direct connection for migrations and ensure SSL options match the
connection string supplied by Supabase. Never put this URI in the frontend.

### 2. Local document storage

For local development, keep:

```env
STORAGE_DRIVER=local
LOCAL_STORAGE_PATH=./storage
```

The directory is created relative to `be/`. Stored document files are encrypted
binary objects, not the original plaintext upload.

### 3. Generate application encryption secrets

Generate five separate values. Do not reuse a key and do not commit the output:

```bash
openssl rand -base64 48
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
```

Put the first value in `JWT_SECRET`. Put the next four values, each prefixed by
`base64:`, in this order:

```env
DOCUMENT_ENCRYPTION_KEY=base64:<first-32-byte-value>
DOCUMENT_METADATA_ENCRYPTION_KEY=base64:<second-32-byte-value>
DOCUMENT_LOOKUP_HMAC_KEY=base64:<third-32-byte-value>
DOCUMENT_DEDUP_HMAC_KEY=base64:<fourth-32-byte-value>
```

These keys respectively protect legacy/server-encrypted files, sensitive
metadata, searchable equality indexes, and user-scoped duplicate detection.

### 4. Browser origin

`CORS_ORIGINS` is a comma-separated allowlist. Keep the example for local Vite.
For deployment, replace it with the exact HTTPS frontend origin.

### 5. Start the backend

```bash
npm run dev
```

Local development automatically creates the client-upload RSA-4096 key pair in
`be/.secrets/`. No RSA variables are needed in the local `.env`.

## Optional environment variables

Do not add these unless the corresponding feature is being used.

### OpenAI document/package analysis

```env
OPENAI_API_KEY=
# Optional overrides; built-in defaults are used when omitted.
OPENAI_VISION_MODEL=gpt-4o-mini
OPENAI_INTENT_MODEL=gpt-5-mini
OPENAI_REQUEST_TIMEOUT_MS=45000
READINESS_AI_PROVIDER=mock
```

Use `READINESS_AI_PROVIDER=mock` only for local development. Omit it to use the
configured OpenAI provider.

### Gmail or Google Drive connection

```env
FRONTEND_URL=http://localhost:5173
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_GMAIL_REDIRECT_URI=http://localhost:4000/api/integrations/gmail/callback
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:4000/api/integrations/drive/callback
GOOGLE_TOKEN_ENCRYPTION_KEY=base64:<dedicated-32-byte-value>
```

Generate `GOOGLE_TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32`. Do not
reuse any document encryption key.

### SMTP password-reset email delivery

Email is disabled by default. To send reset emails through GoDaddy Professional
Email SMTP:

```env
APP_URL=https://your-readiness-web-app.example.com
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=support@readines.info
SMTP_PASS=
SMTP_APP_PASSWORD=
MAIL_FROM="Readiness <support@readines.info>"
EMAIL_FROM_NAME=Readiness
EMAIL_FROM_ADDRESS=support@readines.info
TZ=Asia/Kolkata
```

Set either `SMTP_PASS` or the forgot-password flow's `SMTP_APP_PASSWORD` from
the mailbox credentials. Set either `MAIL_FROM` or `EMAIL_FROM_ADDRESS` (with
optional `EMAIL_FROM_NAME`). Production authentication emails must use a public
HTTPS `APP_URL`; use a local mail catcher or HTTPS tunnel when testing reset
links against a local frontend. The backend verifies SMTP once at startup and
logs a sanitized success/failure event. Run `npm run email:verify-smtp` to
validate SMTP connectivity without sending a message.

### S3-compatible storage (Supabase or AWS)

Replace the local storage variables with:

```env
STORAGE_DRIVER=s3
STORAGE_ENDPOINT=
STORAGE_REGION=
STORAGE_BUCKET=
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
STORAGE_FORCE_PATH_STYLE=false
```

For Supabase, obtain the endpoint and S3 credentials from the Storage S3 access
settings. For AWS, leave `STORAGE_ENDPOINT` empty and create a private S3 bucket
plus an IAM access key restricted to that bucket.

### Vercel backend deployment

This backend deploys to Vercel through `api/index.ts`, which exports the Express app without opening a local listener. Keep `src/index.ts` for local `npm run dev` and `npm start`.

Use the backend directory as the Vercel project root:

```bash
cd /path/to/readiness/backend
vercel link
vercel env add DATABASE_URL production
vercel env add APP_ENV production
vercel env add STORAGE_DRIVER production
vercel env add STORAGE_REGION production
vercel env add STORAGE_BUCKET production
vercel env add STORAGE_ACCESS_KEY_ID production
vercel env add STORAGE_SECRET_ACCESS_KEY production
vercel env add DOCUMENT_ENCRYPTION_KEY production
vercel env add DOCUMENT_METADATA_ENCRYPTION_KEY production
vercel env add DOCUMENT_LOOKUP_HMAC_KEY production
vercel env add DOCUMENT_DEDUP_HMAC_KEY production
vercel env add DOCUMENT_RSA_ACTIVE_KEY_ID production
vercel env add DOCUMENT_RSA_ACTIVE_KEY_VERSION production
vercel env add DOCUMENT_RSA_PUBLIC_KEY production
vercel env add DOCUMENT_RSA_PRIVATE_KEY production
vercel env add DOCUMENT_MALWARE_SCANNER_COMMAND production
vercel env add CORS_ORIGINS production
vercel --prod
```

For Vercel production, set `APP_ENV=production`, `STORAGE_DRIVER=s3`, and use an external database plus S3-compatible object storage. Do not rely on `LOCAL_STORAGE_PATH` or `.secrets/` in Vercel; local uploads use `/tmp` during a function invocation, while permanent encrypted documents must go to S3. Document uploads always validate encrypted envelopes, file size, MIME type, extension, magic bytes, PDF/image structure, and malformed content before storage. `DOCUMENT_MALWARE_SCANNER_COMMAND` is optional and plugs into the same validation flow when ClamAV or a cloud scanner is added later.

Add optional integration env vars only for features you enable: `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, Gmail/Drive redirect URIs, `GOOGLE_TOKEN_ENCRYPTION_KEY`, SMTP settings, and `ADMIN_SEED_TOKEN`.

### Production document keys and malware scanning

Production must use secret-manager/KMS-backed RSA configuration. It must never use `lifepack-development`. External malware scanning is optional until a scanner service is available:

```env
NODE_ENV=production
APP_ENV=production
DOCUMENT_RSA_ACTIVE_KEY_ID=readiness-production-primary
DOCUMENT_RSA_ACTIVE_KEY_VERSION=1
DOCUMENT_RSA_PUBLIC_KEY=base64:<base64-encoded-public-pem>
DOCUMENT_RSA_PRIVATE_KEY=base64:<base64-encoded-private-pem>
DOCUMENT_MALWARE_SCANNER_COMMAND=clamscan
DOCUMENT_MALWARE_SCANNER_ARGS=["--no-summary","{file}"]
ADMIN_SEED_TOKEN=
TRUST_PROXY=1
```

Generate the RSA files using the commands in the encryption section below.
Store private keys and `ADMIN_SEED_TOKEN` in the deployment secret manager.

## Sign in with Google

Readiness uses Google Identity Services to receive a Google ID credential in the browser. The backend verifies it with `google-auth-library`, then issues the same Readiness access and refresh tokens used by email/password login. A Google client secret and redirect callback are not used by this flow.

1. In Google Cloud Console, create or select an OAuth 2.0 **Web application** client.
2. Add these **Authorized JavaScript origins**:
   - `http://localhost:5173`
   - Your exact production frontend origin, for example `https://app.example.com`
3. Do not add a redirect URI for this popup/button flow.
4. Copy each `.env.example` to `.env` in its own project if an `.env` does not already exist.
5. Set the same public Web client ID in:
   - `fe/.env`: `VITE_GOOGLE_CLIENT_ID`
   - `be/.env`: `GOOGLE_CLIENT_ID`
6. Ensure `be/.env` has the frontend origins in `CORS_ORIGINS`.
7. Restart both development servers after changing environment variables.

Google Sign-In itself does not require Google Cloud billing. Basic sign-in requests only the `openid`, `email`, and `profile` identity data; no Google Drive, Gmail, or other API scope is enabled.

To replace the temporary test client later, update only `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID`, update the new client's Authorized JavaScript Origins, and restart or redeploy the frontend and backend.

## Gmail document import

Gmail connection is separate from Google sign-in and is optional. Readiness requests only `https://www.googleapis.com/auth/gmail.readonly`, scans candidate metadata, and downloads content only after the user selects it. It never sends, modifies, labels, marks as read, or deletes email. Selected Gmail content uses the local rules/OCR ingestion pipeline and the normal confirm-before-save flow; it is not sent to an AI provider.

Add these backend variables to `be/.env` without removing existing values:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_GMAIL_REDIRECT_URI=http://localhost:4000/api/integrations/gmail/callback
GOOGLE_TOKEN_ENCRYPTION_KEY=
```

`GOOGLE_TOKEN_ENCRYPTION_KEY` must be a dedicated 32-byte base64 key, optionally prefixed with `base64:`. It encrypts stored Gmail refresh tokens with AES-256-GCM. Access tokens are refreshed in memory and are not stored.

Google Cloud Console setup:

1. Enable **Gmail API** for the OAuth project.
2. Keep the OAuth consent application in **Testing** mode.
3. Add `https://www.googleapis.com/auth/gmail.readonly` to the consent screen scopes.
4. Add each Gmail account used for development under **Test users**.
5. In the OAuth Web client, add this exact **Authorized redirect URI**:
   `http://localhost:4000/api/integrations/gmail/callback`
6. Keep `http://localhost:5173` as an Authorized JavaScript Origin for Google Sign-In.
7. Restart the backend after adding or changing these variables.

Google Cloud billing is not required. Gmail readonly is a restricted scope: Testing-mode test users can develop locally, but a public production launch may require Google OAuth verification and, when restricted-scope data is stored or transmitted by the server, a security assessment under Google's current policy.

## Google identity linking policy

The backend trusts only claims from a successfully verified Google ID token. A new Google account creates one Readiness user and one separate `ExternalIdentity` record. If the token contains the same normalized, Google-verified email as an existing password user, the Google identity links to that user transactionally. Existing names and password hashes are preserved, so password login continues to work. Unique database constraints on normalized email, provider account ID, and provider per user prevent duplicate accounts; serialization/unique-conflict retries handle concurrent first sign-ins.

The Google ID credential is never stored or logged. Readiness continues to use its existing bearer-token and refresh-token storage model.

## Verification

```bash
cd be
npm run prisma:generate
npm run test:google-auth
npm run test:gmail
npm run build
npm run lint

cd ../fe
npm run test:google-auth
npm run test:gmail
npm run build
npm run lint
```
# Portable PostgreSQL and document storage

Readiness uses Prisma with the single `DATABASE_URL` setting. The same Prisma
client and migrations support local PostgreSQL, Supabase PostgreSQL, and AWS
RDS PostgreSQL; the application does not inspect the provider in the URL.

Permanent encrypted documents use `STORAGE_DRIVER=local` or
`STORAGE_DRIVER=s3`. Local development requires `LOCAL_STORAGE_PATH`. S3 mode
requires `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, and
`STORAGE_SECRET_ACCESS_KEY`; `STORAGE_ENDPOINT` is optional so the AWS SDK
default endpoint is used for AWS S3. Supabase's S3-compatible endpoint uses the
same implementation.

Manual uploads are validated and encrypted in the browser with a fresh
AES-256-GCM key and 12-byte IV. The AES key is wrapped with the active
RSA-OAEP-4096/SHA-256 public key. The backend unwraps and decrypts only for
isolated validation/analysis, removes temporary plaintext on every path, and
stores the browser ciphertext as `application/octet-stream`. Existing
absolute-path and server-encrypted records remain readable for backward
compatibility.

The RSA private key is a backend/KMS secret. It must never be copied into a
`VITE_` variable, frontend file, database row, object metadata, or image. To
create local key material:

For local development, when no RSA environment variables are present, Readiness
creates a 4096-bit pair once under `be/.secrets/`. The directory is gitignored;
the private key is written with owner-only permissions. Production never uses
this fallback and fails closed unless explicit secret-managed keys are present.

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out readiness-private.pem
openssl pkey -in readiness-private.pem -pubout -out readiness-public.pem
base64 < readiness-private.pem | tr -d '\n'
base64 < readiness-public.pem | tr -d '\n'
```

Store those final values with the `base64:` prefix in
`DOCUMENT_RSA_PRIVATE_KEY` and `DOCUMENT_RSA_PUBLIC_KEY`, set an immutable
`DOCUMENT_RSA_ACTIVE_KEY_ID` plus positive version, then securely delete the
local PEM files after transferring the private key to the secret manager.

`DOCUMENT_MALWARE_SCANNER_COMMAND` (for example, `clamscan`) and its JSON argument list are optional. Built-in size checks, MIME/extension agreement, magic-byte validation, PDF/image parsing, active content rejection, dimension limits, corruption checks, and EICAR/Windows executable rejection run before encrypted storage even when no external scanner is configured.

For key rotation, retain the old and new private keys in
`DOCUMENT_RSA_KEYRING_JSON`, switch the active ID/version, then preview and
apply metadata-only AES-key rewrapping:

```bash
npm run keys:rewrap
npm run keys:rewrap -- --apply
```

The rotation command unwraps and re-wraps only each 32-byte AES key; it does
not download, decrypt, or rewrite the stored document ciphertext.

## Local development

Copy `.env.example` to `.env`, set `DATABASE_URL` to the local PostgreSQL
connection string, and use `STORAGE_DRIVER=local`. Then run:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

The existing `docker-compose.yml` remains available for local PostgreSQL.

For isolated tests, copy `.env.example` to a temporary untracked `.env`, set
`DATABASE_URL` to a separate `readiness_test` database, run migrations against
it, and run:

```bash
npm run test:storage
npm run build
```

The storage test creates and removes its own temporary directory and makes no
cloud requests.

## Supabase demo setup

1. Create a Supabase project and copy its PostgreSQL connection string.
2. Set `DATABASE_URL` and run the existing Prisma migrations.
3. Create a private bucket named `user-documents`, allow only
   `application/octet-stream`, and deny public/direct-browser access.
4. Generate S3-compatible storage access credentials.
5. Configure the backend using `.env.example`, including the S3 endpoint,
   project region, credentials, encryption key, and application secrets.
6. Deploy only the Express backend with these secrets.
7. Verify authenticated upload, preview/download, replacement, and cleanup.
8. Confirm the frontend receives neither database/storage credentials nor any
   RSA private-key material.

No Supabase SDK, Supabase Auth, direct frontend access, or public object URL is
used.

## Later AWS migration

1. Create PostgreSQL in RDS and a private S3 bucket.
2. Copy PostgreSQL data from Supabase to RDS.
3. Copy encrypted objects without changing their object keys.
4. Configure the backend using `.env.example` (leave `STORAGE_ENDPOINT`
   blank).
5. Redeploy the same backend and verify the document flows.

The data copy is an infrastructure migration; application business logic and
API routes do not change.
