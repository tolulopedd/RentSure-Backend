-- CreateEnum
CREATE TYPE "ProposedRenterDecision" AS ENUM ('APPROVED', 'HOLD', 'DECLINED');

-- AlterTable
ALTER TABLE "ProposedRenter"
ADD COLUMN     "decision" "ProposedRenterDecision",
ADD COLUMN     "decisionAt" TIMESTAMP(3),
ADD COLUMN     "decisionByAccountId" TEXT,
ADD COLUMN     "decisionNote" TEXT;

-- CreateIndex
CREATE INDEX "ProposedRenter_decisionByAccountId_idx" ON "ProposedRenter"("decisionByAccountId");

-- AddForeignKey
ALTER TABLE "ProposedRenter" ADD CONSTRAINT "ProposedRenter_decisionByAccountId_fkey" FOREIGN KEY ("decisionByAccountId") REFERENCES "PublicAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
