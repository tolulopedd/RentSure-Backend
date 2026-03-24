-- CreateEnum
CREATE TYPE "PolicyFeeMode" AS ENUM ('FLAT', 'PERCENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "locationLabel" TEXT;

-- CreateTable
CREATE TABLE "TransactionPolicy" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "transactionType" "FinancialTransactionType" NOT NULL,
    "minAmountRwf" INTEGER,
    "maxAmountRwf" INTEGER,
    "dailyLimitRwf" INTEGER,
    "feeMode" "PolicyFeeMode" NOT NULL DEFAULT 'FLAT',
    "flatFeeRwf" INTEGER NOT NULL DEFAULT 0,
    "percentFeeBps" INTEGER,
    "feeMinRwf" INTEGER NOT NULL DEFAULT 0,
    "feeMaxRwf" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTransactionLimit" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "transactionType" "FinancialTransactionType" NOT NULL,
    "perTransactionMaxRwf" INTEGER,
    "dailyMaxRwf" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTransactionLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionPolicy_transactionType_key" ON "TransactionPolicy"("transactionType");

-- CreateIndex
CREATE INDEX "TransactionPolicy_isActive_idx" ON "TransactionPolicy"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTransactionLimit_userId_transactionType_key" ON "AgentTransactionLimit"("userId", "transactionType");

-- CreateIndex
CREATE INDEX "AgentTransactionLimit_transactionType_isActive_idx" ON "AgentTransactionLimit"("transactionType", "isActive");

-- AddForeignKey
ALTER TABLE "AgentTransactionLimit" ADD CONSTRAINT "AgentTransactionLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
