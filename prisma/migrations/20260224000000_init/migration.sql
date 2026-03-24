CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AGENT', 'LANDLORD', 'RENTER');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "OutletStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "TransactionType" AS ENUM ('CASH_IN', 'CASH_OUT', 'BILL_PAYMENT', 'TRANSFER');
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
CREATE TYPE "CashRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "FloatDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE "Outlet" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "district" TEXT NOT NULL,
  "sector" TEXT NOT NULL,
  "status" "OutletStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "fullName" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "outletId" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Customer" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "fullName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "nationalId" TEXT NULL,
  "outletId" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Customer_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Transaction" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "reference" TEXT NOT NULL UNIQUE,
  "type" "TransactionType" NOT NULL,
  "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
  "amountRwf" INTEGER NOT NULL,
  "feeRwf" INTEGER NOT NULL DEFAULT 0,
  "customerName" TEXT NOT NULL,
  "customerPhone" TEXT NOT NULL,
  "outletId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "externalReference" TEXT NULL,
  "cbsResponse" JSONB NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Transaction_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FloatLedger" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "outletId" TEXT NOT NULL,
  "userId" TEXT NULL,
  "direction" "FloatDirection" NOT NULL,
  "amountRwf" INTEGER NOT NULL,
  "balanceAfterRwf" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FloatLedger_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FloatLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CashRequest" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "outletId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT NULL,
  "amountRwf" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "CashRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewComment" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashRequest_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "RefreshToken" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3) NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "requestId" TEXT NULL,
  "actorUserId" TEXT NULL,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NULL,
  "meta" JSONB NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Outlet_status_idx" ON "Outlet" ("status");
CREATE INDEX "User_role_idx" ON "User" ("role");
CREATE INDEX "User_outletId_idx" ON "User" ("outletId");
CREATE INDEX "Customer_phone_idx" ON "Customer" ("phone");
CREATE INDEX "Customer_outletId_idx" ON "Customer" ("outletId");
CREATE INDEX "Transaction_outletId_createdAt_idx" ON "Transaction" ("outletId", "createdAt");
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction" ("userId", "createdAt");
CREATE INDEX "FloatLedger_outletId_createdAt_idx" ON "FloatLedger" ("outletId", "createdAt");
CREATE INDEX "CashRequest_outletId_status_idx" ON "CashRequest" ("outletId", "status");
CREATE INDEX "CashRequest_requestedByUserId_idx" ON "CashRequest" ("requestedByUserId");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken" ("userId");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken" ("expiresAt");
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog" ("actorUserId");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog" ("action", "createdAt");
