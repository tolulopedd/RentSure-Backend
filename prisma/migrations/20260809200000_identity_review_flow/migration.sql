CREATE TYPE "IdentityReviewStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'FAILED');

ALTER TYPE "PublicNotificationType" ADD VALUE IF NOT EXISTS 'IDENTITY_REVIEW';

ALTER TABLE "PublicAccount"
ADD COLUMN "identityVerificationType" TEXT,
ADD COLUMN "identitySubmittedAt" TIMESTAMP(3),
ADD COLUMN "identityReviewStatus" "IdentityReviewStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
ADD COLUMN "identityReviewedAt" TIMESTAMP(3),
ADD COLUMN "identityReviewedByUserId" TEXT,
ADD COLUMN "identityReviewComment" TEXT;

CREATE INDEX "PublicAccount_identityReviewStatus_idx" ON "PublicAccount"("identityReviewStatus");
CREATE INDEX "PublicAccount_identityReviewedByUserId_idx" ON "PublicAccount"("identityReviewedByUserId");

ALTER TABLE "PublicAccount"
ADD CONSTRAINT "PublicAccount_identityReviewedByUserId_fkey"
FOREIGN KEY ("identityReviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
