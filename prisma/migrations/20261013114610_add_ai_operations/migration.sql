-- CreateTable
CREATE TABLE "ai_task_configs" (
    "id" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "primaryModel" TEXT NOT NULL,
    "fallbackModel" TEXT,
    "promptConfig" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_task_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_revisions" (
    "id" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "primaryModel" TEXT NOT NULL,
    "fallbackModel" TEXT,
    "promptConfig" JSONB NOT NULL,
    "testResult" JSONB,
    "publishedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_budgets" (
    "id" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "monthlyCapUsd" DECIMAL(10,2) NOT NULL,
    "updatedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_request_logs" (
    "id" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "userId" TEXT,
    "model" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costUsd" DECIMAL(10,4),
    "durationMs" INTEGER,
    "targetType" TEXT,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_task_configs_taskKey_key" ON "ai_task_configs"("taskKey");

-- CreateIndex
CREATE INDEX "prompt_revisions_taskKey_version_idx" ON "prompt_revisions"("taskKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_budgets_taskKey_key" ON "ai_budgets"("taskKey");

-- CreateIndex
CREATE INDEX "ai_request_logs_taskKey_createdAt_idx" ON "ai_request_logs"("taskKey", "createdAt");

-- CreateIndex
CREATE INDEX "ai_request_logs_userId_idx" ON "ai_request_logs"("userId");

-- AddForeignKey
ALTER TABLE "prompt_revisions" ADD CONSTRAINT "prompt_revisions_taskKey_fkey" FOREIGN KEY ("taskKey") REFERENCES "ai_task_configs"("taskKey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_revisions" ADD CONSTRAINT "prompt_revisions_publishedByAdminId_fkey" FOREIGN KEY ("publishedByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request_logs" ADD CONSTRAINT "ai_request_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
