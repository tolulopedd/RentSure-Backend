-- CreateEnum
CREATE TYPE "LoanInstallmentStatus" AS ENUM ('OUTSTANDING', 'PAID');

-- CreateEnum
CREATE TYPE "LoanRepaymentSource" AS ENUM ('CUSTOMER_ACCOUNT', 'AGENT_ACCOUNT');

-- CreateTable
CREATE TABLE "LoanProduct" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "description" TEXT,
    "minTenorMonths" INTEGER NOT NULL,
    "maxTenorMonths" INTEGER NOT NULL,
    "monthlyInterestRatePct" DOUBLE PRECISION NOT NULL,
    "loanRateSpreadPct" DOUBLE PRECISION NOT NULL,
    "loanManagementFeePct" DOUBLE PRECISION NOT NULL,
    "loanDefaultRatePct" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanInstallment" (
    "id" TEXT NOT NULL,
    "loanRequestId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "paidAmountRwf" INTEGER NOT NULL DEFAULT 0,
    "status" "LoanInstallmentStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "paidAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "paymentSource" "LoanRepaymentSource",
    "paymentReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanProduct_productCode_key" ON "LoanProduct"("productCode");

-- CreateIndex
CREATE INDEX "LoanProduct_isActive_idx" ON "LoanProduct"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LoanInstallment_loanRequestId_installmentNumber_key" ON "LoanInstallment"("loanRequestId", "installmentNumber");

-- CreateIndex
CREATE INDEX "LoanInstallment_status_dueDate_idx" ON "LoanInstallment"("status", "dueDate");

-- CreateIndex
CREATE INDEX "LoanInstallment_paymentReference_idx" ON "LoanInstallment"("paymentReference");

-- AddForeignKey
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_loanRequestId_fkey" FOREIGN KEY ("loanRequestId") REFERENCES "LoanRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
