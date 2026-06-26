-- CreateEnum
CREATE TYPE "LandlordReferenceRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'DECLINED');

-- CreateEnum
CREATE TYPE "LandlordReferenceRecommendation" AS ENUM ('STRONGLY_RECOMMEND', 'RECOMMEND', 'NEUTRAL', 'DO_NOT_RECOMMEND');

-- CreateTable
CREATE TABLE "LandlordReferenceRequest" (
    "id" TEXT NOT NULL,
    "proposedRenterId" TEXT NOT NULL,
    "renterAccountId" TEXT NOT NULL,
    "landlordAccountId" TEXT NOT NULL,
    "status" "LandlordReferenceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "recommendation" "LandlordReferenceRecommendation",
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandlordReferenceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LandlordReferenceRequest_proposedRenterId_createdAt_idx" ON "LandlordReferenceRequest"("proposedRenterId", "createdAt");

-- CreateIndex
CREATE INDEX "LandlordReferenceRequest_renterAccountId_createdAt_idx" ON "LandlordReferenceRequest"("renterAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "LandlordReferenceRequest_landlordAccountId_status_createdAt_idx" ON "LandlordReferenceRequest"("landlordAccountId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "LandlordReferenceRequest" ADD CONSTRAINT "LandlordReferenceRequest_proposedRenterId_fkey" FOREIGN KEY ("proposedRenterId") REFERENCES "ProposedRenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandlordReferenceRequest" ADD CONSTRAINT "LandlordReferenceRequest_renterAccountId_fkey" FOREIGN KEY ("renterAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandlordReferenceRequest" ADD CONSTRAINT "LandlordReferenceRequest_landlordAccountId_fkey" FOREIGN KEY ("landlordAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
