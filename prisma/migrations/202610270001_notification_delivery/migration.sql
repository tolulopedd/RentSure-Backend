ALTER TYPE "PublicNotificationType" ADD VALUE IF NOT EXISTS 'STAKEHOLDER_UPDATE';
ALTER TABLE "PublicAccountNotification" ALTER COLUMN "publicAccountId" DROP NOT NULL,
 ADD COLUMN "staffUserId" TEXT, ADD COLUMN "eventKey" TEXT;
ALTER TABLE "PublicAccountNotification" ADD CONSTRAINT "PublicAccountNotification_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicAccountNotification" ADD CONSTRAINT "notification_one_recipient" CHECK (("publicAccountId" IS NOT NULL)::int + ("staffUserId" IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX "PublicAccountNotification_eventKey_key" ON "PublicAccountNotification"("eventKey");
CREATE INDEX "PublicAccountNotification_staffUserId_readAt_createdAt_idx" ON "PublicAccountNotification"("staffUserId", "readAt", "createdAt");
CREATE TABLE "NotificationEmail" (
 "id" TEXT PRIMARY KEY, "notificationId" TEXT, "dedupeKey" TEXT,
 "recipient" TEXT NOT NULL, "subject" TEXT NOT NULL, "html" TEXT NOT NULL, "category" TEXT NOT NULL,
 "attempts" INTEGER NOT NULL DEFAULT 0, "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lockedUntil" TIMESTAMP(3), "lockToken" TEXT, "deliveredAt" TIMESTAMP(3), "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "NotificationEmail_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "PublicAccountNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationEmail_notificationId_key" ON "NotificationEmail"("notificationId");
CREATE UNIQUE INDEX "NotificationEmail_dedupeKey_key" ON "NotificationEmail"("dedupeKey");
CREATE INDEX "NotificationEmail_deliveredAt_availableAt_lockedUntil_idx" ON "NotificationEmail"("deliveredAt", "availableAt", "lockedUntil");
