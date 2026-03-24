-- CreateTable
CREATE TABLE "RoleTransactionLimit" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "role" "UserRole" NOT NULL,
    "transactionType" "FinancialTransactionType" NOT NULL,
    "perTransactionMaxRwf" INTEGER,
    "dailyMaxRwf" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleTransactionLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleTransactionLimit_role_transactionType_key" ON "RoleTransactionLimit"("role", "transactionType");

-- CreateIndex
CREATE INDEX "RoleTransactionLimit_transactionType_isActive_idx" ON "RoleTransactionLimit"("transactionType", "isActive");
