-- User management lifecycle, admin roles, and notes.
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN', 'READ_ONLY_ADMIN');

ALTER TYPE "UserStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "UserStatus" ADD VALUE 'BLOCKED';
ALTER TYPE "PublicAccountStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "PublicAccountStatus" ADD VALUE 'BLOCKED';

ALTER TABLE "User"
  ADD COLUMN "adminRole" "AdminRole",
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

ALTER TABLE "PublicAccount"
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

CREATE TABLE "AdminNote" (
  "id" TEXT NOT NULL,
  "publicAccountId" TEXT,
  "userId" TEXT,
  "authorUserId" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminNote_publicAccountId_createdAt_idx" ON "AdminNote"("publicAccountId", "createdAt");
CREATE INDEX "AdminNote_userId_createdAt_idx" ON "AdminNote"("userId", "createdAt");
CREATE INDEX "AdminNote_authorUserId_createdAt_idx" ON "AdminNote"("authorUserId", "createdAt");

ALTER TABLE "AdminNote"
  ADD CONSTRAINT "AdminNote_publicAccountId_fkey"
  FOREIGN KEY ("publicAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AdminNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AdminNote_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
