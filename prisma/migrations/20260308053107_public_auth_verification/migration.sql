-- CreateEnum
CREATE TYPE "PublicAccountType" AS ENUM ('RENTER', 'LANDLORD', 'AGENT');

-- CreateEnum
CREATE TYPE "PublicEntityType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "PublicAccountStatus" AS ENUM ('UNVERIFIED', 'ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "AgentTransactionLimit" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LimitRoleTemplate" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LimitRoleTemplateLimit" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RoleTransactionLimit" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TransactionPolicy" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "PublicAccount" (
    "id" TEXT NOT NULL,
    "accountType" "PublicAccountType" NOT NULL,
    "entityType" "PublicEntityType" NOT NULL,
    "representation" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "organizationName" TEXT,
    "registrationNumber" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "propertyCount" TEXT,
    "portfolioType" TEXT,
    "notes" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "status" "PublicAccountStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicRefreshToken" (
    "id" TEXT NOT NULL,
    "publicAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "publicAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicAccount_email_key" ON "PublicAccount"("email");

-- CreateIndex
CREATE INDEX "PublicAccount_accountType_idx" ON "PublicAccount"("accountType");

-- CreateIndex
CREATE INDEX "PublicAccount_entityType_idx" ON "PublicAccount"("entityType");

-- CreateIndex
CREATE INDEX "PublicAccount_status_idx" ON "PublicAccount"("status");

-- CreateIndex
CREATE INDEX "PublicRefreshToken_publicAccountId_idx" ON "PublicRefreshToken"("publicAccountId");

-- CreateIndex
CREATE INDEX "PublicRefreshToken_expiresAt_idx" ON "PublicRefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_publicAccountId_idx" ON "EmailVerificationToken"("publicAccountId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "PublicRefreshToken" ADD CONSTRAINT "PublicRefreshToken_publicAccountId_fkey" FOREIGN KEY ("publicAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_publicAccountId_fkey" FOREIGN KEY ("publicAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
