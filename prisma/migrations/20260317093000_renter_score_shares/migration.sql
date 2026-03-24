-- CreateEnum
CREATE TYPE "RenterScoreShareRecipientType" AS ENUM ('LANDLORD', 'AGENT');

-- CreateTable
CREATE TABLE "RenterScoreShare" (
    "id" TEXT NOT NULL,
    "publicAccountId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientType" "RenterScoreShareRecipientType" NOT NULL,
    "recipientAccountId" TEXT,
    "note" TEXT,
    "score" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "scoreBand" TEXT NOT NULL,
    "reportPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenterScoreShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RenterScoreShare_publicAccountId_createdAt_idx" ON "RenterScoreShare"("publicAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "RenterScoreShare_recipientEmail_createdAt_idx" ON "RenterScoreShare"("recipientEmail", "createdAt");

-- CreateIndex
CREATE INDEX "RenterScoreShare_recipientAccountId_idx" ON "RenterScoreShare"("recipientAccountId");

-- AddForeignKey
ALTER TABLE "RenterScoreShare"
ADD CONSTRAINT "RenterScoreShare_publicAccountId_fkey"
FOREIGN KEY ("publicAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenterScoreShare"
ADD CONSTRAINT "RenterScoreShare_recipientAccountId_fkey"
FOREIGN KEY ("recipientAccountId") REFERENCES "PublicAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
