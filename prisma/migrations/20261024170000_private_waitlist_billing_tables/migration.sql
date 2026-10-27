-- These tables are owned by the backend; browsers must use authenticated APIs
-- or the abuse-protected public waitlist flow, never Supabase's Data API.
ALTER TABLE "WaitlistRegistration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistProof" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistRateLimit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingWebhookEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WaitlistRegistration", "WaitlistProof", "WaitlistRateLimit", "BillingSubscription", "BillingPayment", "BillingWebhookEvent" FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "WaitlistRegistration", "WaitlistProof", "WaitlistRateLimit", "BillingSubscription", "BillingPayment", "BillingWebhookEvent" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
