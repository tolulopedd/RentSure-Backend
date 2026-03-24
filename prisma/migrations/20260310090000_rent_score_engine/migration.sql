-- CreateTable
CREATE TABLE "RentScorePolicy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minScore" INTEGER NOT NULL DEFAULT 0,
    "maxScore" INTEGER NOT NULL DEFAULT 900,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentScorePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentScoreRule" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "points" INTEGER NOT NULL,
    "maxOccurrences" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentScoreRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentScoreEvent" (
    "id" TEXT NOT NULL,
    "publicAccountId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT,
    "sourceNote" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentScoreEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentScorePolicy_code_key" ON "RentScorePolicy"("code");

-- CreateIndex
CREATE INDEX "RentScorePolicy_isActive_idx" ON "RentScorePolicy"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RentScoreRule_policyId_code_key" ON "RentScoreRule"("policyId", "code");

-- CreateIndex
CREATE INDEX "RentScoreRule_policyId_isActive_idx" ON "RentScoreRule"("policyId", "isActive");

-- CreateIndex
CREATE INDEX "RentScoreRule_sortOrder_idx" ON "RentScoreRule"("sortOrder");

-- CreateIndex
CREATE INDEX "RentScoreEvent_publicAccountId_occurredAt_idx" ON "RentScoreEvent"("publicAccountId", "occurredAt");

-- CreateIndex
CREATE INDEX "RentScoreEvent_ruleId_occurredAt_idx" ON "RentScoreEvent"("ruleId", "occurredAt");

-- CreateIndex
CREATE INDEX "RentScoreEvent_recordedByUserId_idx" ON "RentScoreEvent"("recordedByUserId");

-- AddForeignKey
ALTER TABLE "RentScoreRule" ADD CONSTRAINT "RentScoreRule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "RentScorePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentScoreEvent" ADD CONSTRAINT "RentScoreEvent_publicAccountId_fkey" FOREIGN KEY ("publicAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentScoreEvent" ADD CONSTRAINT "RentScoreEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RentScoreRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentScoreEvent" ADD CONSTRAINT "RentScoreEvent_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
