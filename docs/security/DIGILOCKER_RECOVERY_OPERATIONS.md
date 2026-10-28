# DigiLocker unattended recovery

The Readines Supabase project runs `digilocker-recovery-every-minute` through
`pg_cron`. This replaces reliance on Vercel Hobby's daily cron for prompt
unattended recovery. The Vercel daily job remains a secondary cleanup path.

The job calls the fixed registered backend worker URL only when a lease is
eligible, a session has expired, or terminal credentials need revocation. It uses
the synchronous `http` extension, so bearer headers are not persisted in an
asynchronous transport queue. Only one run of this named job executes at a time.
An active run can occupy one database connection for up to 295 seconds; provider
work remains in the Vercel worker. Existing PostgreSQL leases enforce three
active import slots across all invocations.

The dedicated bearer token stays in Vault as `digilocker_worker_bearer`. Only
its SHA-256 verifier is configured in Vercel as
`DIGILOCKER_WORKER_TOKEN_SHA256`; that verifier is not accepted as a bearer token.
The existing `CRON_SECRET` continues to authorize Vercel's daily job. Never place
either token in a cron command, migration, report, URL, browser, or source file.

## Verify without exposing credentials

```sql
SELECT j.jobname, j.schedule, j.active, r.status, r.start_time, r.end_time,
       r.return_message
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT status, start_time, end_time, return_message
  FROM cron.job_run_details WHERE jobid = j.jobid
  ORDER BY start_time DESC LIMIT 1
) r ON true
WHERE j.jobname = 'digilocker-recovery-every-minute';
```

`0 rows` is a successful idle tick. HTTP 200 with eligible work indicates the
worker invocation completed; the session's durable status is the import result.
Review failed cron runs and Vercel worker failures rather than assuming a
successful cron statement means every document imported.

## Pause or resume

```sql
SELECT cron.alter_job(jobid, active := false)
FROM cron.job WHERE jobname = 'digilocker-recovery-every-minute';
-- Use active := true to resume.
```

## Rotate

Pause the named job, update the Vault secret with a cryptographically random
token, calculate its SHA-256 inside the database, configure the verifier in
Vercel, deploy the backend, verify an authorized call from the database, then
resume. Do not print the token. An interrupted rotation pauses recovery but does
not discard durable import progress or alter document encryption keys.

## Hosted verification

`src/scripts/verifyDigiLockerHosted.ts` is an offline CLI/build harness requiring
`DIGILOCKER_HOSTED_VERIFICATION=1`. It creates unique synthetic accounts and
cleans them up in `finally`. It checks ownership, consent boundaries, forged
tokens, replay, cancellation, scheduler-driven expiry, and bounded authenticated
load. It is never mounted as an API endpoint. Verification-only builds exit
before publishing; an intentional build error is not a successful test unless
the final structured check report explicitly says the checks passed.
