-- CreateEnum
CREATE TYPE "ProposedRenterActivityType" AS ENUM (
    'COMMENT',
    'CREATED',
    'SCORE_REQUESTED',
    'SCORE_FORWARDED',
    'DECISION',
    'PAYMENT_SCHEDULE_CREATED',
    'PAYMENT_SCHEDULE_UPDATED',
    'RENTER_PAYMENT_CONFIRMED'
);

-- AlterTable
ALTER TABLE "PaymentSchedule"
ADD COLUMN "confirmationNote" TEXT,
ADD COLUMN "confirmedByRenterAt" TIMESTAMP(3),
ADD COLUMN "receiptReference" TEXT;

-- AlterTable
ALTER TABLE "PublicAccount"
ADD COLUMN "bvn" TEXT,
ADD COLUMN "bvnVerifiedAt" TIMESTAMP(3),
ADD COLUMN "nin" TEXT,
ADD COLUMN "ninVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProposedRenterActivity" (
    "id" TEXT NOT NULL,
    "proposedRenterId" TEXT NOT NULL,
    "actorAccountId" TEXT,
    "activityType" "ProposedRenterActivityType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposedRenterActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProposedRenterActivity_proposedRenterId_createdAt_idx" ON "ProposedRenterActivity"("proposedRenterId", "createdAt");

-- CreateIndex
CREATE INDEX "ProposedRenterActivity_actorAccountId_idx" ON "ProposedRenterActivity"("actorAccountId");

-- CreateIndex
CREATE INDEX "ProposedRenterActivity_activityType_createdAt_idx" ON "ProposedRenterActivity"("activityType", "createdAt");

-- AddForeignKey
ALTER TABLE "ProposedRenterActivity"
ADD CONSTRAINT "ProposedRenterActivity_proposedRenterId_fkey"
FOREIGN KEY ("proposedRenterId") REFERENCES "ProposedRenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedRenterActivity"
ADD CONSTRAINT "ProposedRenterActivity_actorAccountId_fkey"
FOREIGN KEY ("actorAccountId") REFERENCES "PublicAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
