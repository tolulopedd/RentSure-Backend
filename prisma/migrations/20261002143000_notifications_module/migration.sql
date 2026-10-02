ALTER TYPE "PublicNotificationType" ADD VALUE IF NOT EXISTS 'APPLICATION_SUBMITTED';
ALTER TYPE "PublicNotificationType" ADD VALUE IF NOT EXISTS 'APPLICATION_APPROVED';
ALTER TYPE "PublicNotificationType" ADD VALUE IF NOT EXISTS 'APPLICATION_REJECTED';
ALTER TYPE "PublicNotificationType" ADD VALUE IF NOT EXISTS 'LEASE_CREATED';
ALTER TYPE "PublicNotificationType" ADD VALUE IF NOT EXISTS 'LEASE_ACCEPTED';
ALTER TYPE "PublicNotificationType" ADD VALUE IF NOT EXISTS 'VERIFICATION_COMPLETE';

ALTER TABLE "PublicAccountNotification"
ADD COLUMN "relatedEntityType" TEXT,
ADD COLUMN "relatedEntityId" TEXT;

CREATE INDEX "PublicAccountNotification_relatedEntityType_relatedEntityId_idx"
ON "PublicAccountNotification"("relatedEntityType", "relatedEntityId");

