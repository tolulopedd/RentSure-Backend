ALTER TABLE "RentScorePayment"
ADD COLUMN "reportApprovedAt" TIMESTAMP(3),
ADD COLUMN "reportApprovedByUserId" TEXT;

ALTER TABLE "RentScorePayment"
ADD CONSTRAINT "RentScorePayment_reportApprovedByUserId_fkey"
FOREIGN KEY ("reportApprovedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "RentScorePayment_reportApprovedAt_createdAt_idx"
ON "RentScorePayment"("reportApprovedAt", "createdAt");
