-- Add richer payment confirmation workflow metadata.
ALTER TYPE "ProposedRenterActivityType" ADD VALUE IF NOT EXISTS 'PAYMENT_CONFIRMATION_INITIATED';
ALTER TYPE "ProposedRenterActivityType" ADD VALUE IF NOT EXISTS 'PAYMENT_CONFIRMED';

ALTER TABLE "PaymentSchedule"
ADD COLUMN IF NOT EXISTS "paymentEvidenceObjectKey" TEXT,
ADD COLUMN IF NOT EXISTS "paymentEvidenceFileName" TEXT,
ADD COLUMN IF NOT EXISTS "paymentEvidenceMimeType" TEXT,
ADD COLUMN IF NOT EXISTS "paymentEvidenceFileSize" INTEGER,
ADD COLUMN IF NOT EXISTS "paymentEvidenceUploadedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "confirmationInitiatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "confirmationInitiatedByAccountId" TEXT,
ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "confirmedByAccountId" TEXT,
ADD COLUMN IF NOT EXISTS "confirmationTiming" TEXT;

CREATE INDEX IF NOT EXISTS "PaymentSchedule_confirmationInitiatedByAccountId_idx"
ON "PaymentSchedule"("confirmationInitiatedByAccountId");

CREATE INDEX IF NOT EXISTS "PaymentSchedule_confirmedByAccountId_idx"
ON "PaymentSchedule"("confirmedByAccountId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PaymentSchedule_confirmationInitiatedByAccountId_fkey'
  ) THEN
    ALTER TABLE "PaymentSchedule"
      ADD CONSTRAINT "PaymentSchedule_confirmationInitiatedByAccountId_fkey"
      FOREIGN KEY ("confirmationInitiatedByAccountId")
      REFERENCES "PublicAccount"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PaymentSchedule_confirmedByAccountId_fkey'
  ) THEN
    ALTER TABLE "PaymentSchedule"
      ADD CONSTRAINT "PaymentSchedule_confirmedByAccountId_fkey"
      FOREIGN KEY ("confirmedByAccountId")
      REFERENCES "PublicAccount"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
