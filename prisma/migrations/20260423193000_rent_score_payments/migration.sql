-- CreateEnum
CREATE TYPE "RentScorePaymentProvider" AS ENUM ('PAYSTACK', 'FLUTTERWAVE', 'MANUAL_TRANSFER');

-- CreateEnum
CREATE TYPE "RentScorePaymentStatus" AS ENUM ('PENDING', 'PENDING_ACTION', 'AWAITING_MANUAL_CONFIRMATION', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RentScorePayment" (
    "id" TEXT NOT NULL,
    "proposedRenterId" TEXT NOT NULL,
    "requestedByAccountId" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "scoreRequestId" TEXT,
    "provider" "RentScorePaymentProvider" NOT NULL,
    "status" "RentScorePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountNgn" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "reference" TEXT NOT NULL,
    "gatewayReference" TEXT,
    "checkoutUrl" TEXT,
    "callbackUrl" TEXT,
    "manualTransferReference" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "paidAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentScorePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentScorePayment_scoreRequestId_key" ON "RentScorePayment"("scoreRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "RentScorePayment_reference_key" ON "RentScorePayment"("reference");

-- CreateIndex
CREATE INDEX "RentScorePayment_proposedRenterId_createdAt_idx" ON "RentScorePayment"("proposedRenterId", "createdAt");

-- CreateIndex
CREATE INDEX "RentScorePayment_requestedByAccountId_createdAt_idx" ON "RentScorePayment"("requestedByAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "RentScorePayment_status_createdAt_idx" ON "RentScorePayment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "RentScorePayment" ADD CONSTRAINT "RentScorePayment_proposedRenterId_fkey" FOREIGN KEY ("proposedRenterId") REFERENCES "ProposedRenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentScorePayment" ADD CONSTRAINT "RentScorePayment_requestedByAccountId_fkey" FOREIGN KEY ("requestedByAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentScorePayment" ADD CONSTRAINT "RentScorePayment_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentScorePayment" ADD CONSTRAINT "RentScorePayment_scoreRequestId_fkey" FOREIGN KEY ("scoreRequestId") REFERENCES "ScoreRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
