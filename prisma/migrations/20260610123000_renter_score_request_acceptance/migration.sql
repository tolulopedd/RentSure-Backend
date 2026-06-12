-- AlterType
ALTER TYPE "ProposedRenterActivityType" ADD VALUE IF NOT EXISTS 'SCORE_REQUEST_ACCEPTED';

-- AlterTable
ALTER TABLE "ScoreRequest" ADD COLUMN "acceptedAt" TIMESTAMP(3);
