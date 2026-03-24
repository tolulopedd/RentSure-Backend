-- CreateEnum
CREATE TYPE "FinancialTransactionType" AS ENUM ('CASH_WITHDRAWAL', 'CASH_DEPOSIT', 'TRANSFER_INTRABANK', 'TRANSFER_INTERBANK', 'TRANSFER_WALLET', 'WALLET_CREDIT', 'WALLET_DEBIT', 'COLLECTION', 'BILL_PAYMENT', 'REMITTANCE', 'LOAN_DISBURSEMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "FinancialTransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FinancialChannel" AS ENUM ('WEB', 'MOBILE', 'USSD', 'API');

-- CreateEnum
CREATE TYPE "PayloadProtectionMode" AS ENUM ('REDACTED', 'ENCRYPTED');

-- CreateEnum
CREATE TYPE "AccountOpeningStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LoanRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DISBURSED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationProviderType" AS ENUM ('COLLECTIONS', 'BILLS_PAYMENT', 'REMITTANCE');

-- CreateEnum
CREATE TYPE "IntegrationAuthType" AS ENUM ('NONE', 'API_KEY', 'BASIC', 'BEARER', 'HMAC');

-- CreateTable
CREATE TABLE "IntegrationProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "IntegrationProviderType" NOT NULL,
    "baseUrl" TEXT,
    "authType" "IntegrationAuthType" NOT NULL DEFAULT 'NONE',
    "authConfig" JSONB,
    "signatureConfig" JSONB,
    "endpoints" JSONB,
    "retryPolicy" JSONB,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialTransaction" (
    "id" TEXT NOT NULL,
    "internalReference" TEXT NOT NULL,
    "cbsReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "channel" "FinancialChannel" NOT NULL DEFAULT 'WEB',
    "type" "FinancialTransactionType" NOT NULL,
    "status" "FinancialTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "agentUserId" TEXT NOT NULL,
    "outletId" TEXT,
    "providerId" TEXT,
    "providerOperation" TEXT,
    "customerNameMasked" TEXT,
    "customerPhoneMasked" TEXT,
    "customerAccountMasked" TEXT,
    "customerExternalId" TEXT,
    "amountRwf" INTEGER NOT NULL,
    "feeRwf" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payloadProtection" "PayloadProtectionMode" NOT NULL DEFAULT 'REDACTED',
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "metadata" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "initiatorIp" TEXT,

    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountOpeningApplication" (
    "id" TEXT NOT NULL,
    "applicationReference" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "outletId" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "idType" TEXT NOT NULL,
    "idNumberMasked" TEXT NOT NULL,
    "biometricsPlaceholder" TEXT,
    "photoUrl" TEXT,
    "nextOfKinName" TEXT,
    "nextOfKinPhone" TEXT,
    "status" "AccountOpeningStatus" NOT NULL DEFAULT 'PENDING',
    "comments" TEXT,
    "cbsReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "AccountOpeningApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletBalanceCache" (
    "id" TEXT NOT NULL,
    "accountIdentifier" TEXT NOT NULL,
    "customerPhoneMasked" TEXT,
    "lastKnownBalanceRwf" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "sourceReference" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletBalanceCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanRequest" (
    "id" TEXT NOT NULL,
    "requestReference" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "outletId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhoneMasked" TEXT NOT NULL,
    "customerAccountMasked" TEXT,
    "requestedAmountRwf" INTEGER NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "monthlyIncomeRwf" INTEGER,
    "monthlyExpensesRwf" INTEGER,
    "existingLoanRepaymentRwf" INTEGER,
    "status" "LoanRequestStatus" NOT NULL DEFAULT 'PENDING',
    "cbsReference" TEXT,
    "repaymentSchedule" JSONB,
    "comments" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "LoanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationProvider_name_key" ON "IntegrationProvider"("name");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationProvider_code_key" ON "IntegrationProvider"("code");

-- CreateIndex
CREATE INDEX "IntegrationProvider_type_isActive_idx" ON "IntegrationProvider"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransaction_internalReference_key" ON "FinancialTransaction"("internalReference");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransaction_idempotencyKey_key" ON "FinancialTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialTransaction_agentUserId_createdAt_idx" ON "FinancialTransaction"("agentUserId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialTransaction_outletId_createdAt_idx" ON "FinancialTransaction"("outletId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialTransaction_status_createdAt_idx" ON "FinancialTransaction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialTransaction_cbsReference_idx" ON "FinancialTransaction"("cbsReference");

-- CreateIndex
CREATE INDEX "FinancialTransaction_type_createdAt_idx" ON "FinancialTransaction"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountOpeningApplication_applicationReference_key" ON "AccountOpeningApplication"("applicationReference");

-- CreateIndex
CREATE UNIQUE INDEX "AccountOpeningApplication_idempotencyKey_key" ON "AccountOpeningApplication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AccountOpeningApplication_agentUserId_createdAt_idx" ON "AccountOpeningApplication"("agentUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountOpeningApplication_status_createdAt_idx" ON "AccountOpeningApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AccountOpeningApplication_cbsReference_idx" ON "AccountOpeningApplication"("cbsReference");

-- CreateIndex
CREATE UNIQUE INDEX "WalletBalanceCache_accountIdentifier_key" ON "WalletBalanceCache"("accountIdentifier");

-- CreateIndex
CREATE INDEX "WalletBalanceCache_lastSyncedAt_idx" ON "WalletBalanceCache"("lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoanRequest_requestReference_key" ON "LoanRequest"("requestReference");

-- CreateIndex
CREATE UNIQUE INDEX "LoanRequest_idempotencyKey_key" ON "LoanRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LoanRequest_agentUserId_createdAt_idx" ON "LoanRequest"("agentUserId", "createdAt");

-- CreateIndex
CREATE INDEX "LoanRequest_status_createdAt_idx" ON "LoanRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LoanRequest_cbsReference_idx" ON "LoanRequest"("cbsReference");

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "IntegrationProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountOpeningApplication" ADD CONSTRAINT "AccountOpeningApplication_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountOpeningApplication" ADD CONSTRAINT "AccountOpeningApplication_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
