-- CreateTable
CREATE TABLE "sign_in_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "method" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sign_in_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sign_in_events_userId_idx" ON "sign_in_events"("userId");

-- CreateIndex
CREATE INDEX "sign_in_events_at_idx" ON "sign_in_events"("at");

-- AddForeignKey
ALTER TABLE "sign_in_events" ADD CONSTRAINT "sign_in_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
