-- AlterTable
ALTER TABLE "PublicAccount"
ADD COLUMN "acceptedTermsAt" TIMESTAMP(3),
ADD COLUMN "acceptedTermsVersion" TEXT;

-- CreateTable
CREATE TABLE "PropertyAgentInvite" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "invitedByAccountId" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "recipientAccountId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PropertyAgentInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyAgentInvite_propertyId_recipientEmail_key" ON "PropertyAgentInvite"("propertyId", "recipientEmail");

-- CreateIndex
CREATE INDEX "PropertyAgentInvite_recipientEmail_idx" ON "PropertyAgentInvite"("recipientEmail");

-- CreateIndex
CREATE INDEX "PropertyAgentInvite_recipientAccountId_idx" ON "PropertyAgentInvite"("recipientAccountId");

-- CreateIndex
CREATE INDEX "PropertyAgentInvite_invitedByAccountId_idx" ON "PropertyAgentInvite"("invitedByAccountId");

-- AddForeignKey
ALTER TABLE "PropertyAgentInvite"
ADD CONSTRAINT "PropertyAgentInvite_propertyId_fkey"
FOREIGN KEY ("propertyId") REFERENCES "Property"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAgentInvite"
ADD CONSTRAINT "PropertyAgentInvite_invitedByAccountId_fkey"
FOREIGN KEY ("invitedByAccountId") REFERENCES "PublicAccount"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAgentInvite"
ADD CONSTRAINT "PropertyAgentInvite_recipientAccountId_fkey"
FOREIGN KEY ("recipientAccountId") REFERENCES "PublicAccount"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
