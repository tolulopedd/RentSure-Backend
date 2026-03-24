/*
  Warnings:

  - You are about to drop the column `outletId` on the `User` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_fkey";

-- DropIndex
DROP INDEX "User_outletId_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "outletId";

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
