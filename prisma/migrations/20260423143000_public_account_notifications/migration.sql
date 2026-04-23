-- CreateEnum
CREATE TYPE "PublicNotificationType" AS ENUM ('PROPERTY_LINKED');

-- CreateTable
CREATE TABLE "PublicAccountNotification" (
    "id" TEXT NOT NULL,
    "publicAccountId" TEXT NOT NULL,
    "notificationType" "PublicNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaPath" TEXT,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicAccountNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicAccountNotification_publicAccountId_createdAt_idx" ON "PublicAccountNotification"("publicAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "PublicAccountNotification_publicAccountId_readAt_createdAt_idx" ON "PublicAccountNotification"("publicAccountId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "PublicAccountNotification" ADD CONSTRAINT "PublicAccountNotification_publicAccountId_fkey" FOREIGN KEY ("publicAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
