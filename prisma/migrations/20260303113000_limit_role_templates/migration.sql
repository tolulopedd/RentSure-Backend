-- CreateTable
CREATE TABLE "LimitRoleTemplate" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "templateCode" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LimitRoleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LimitRoleTemplateLimit" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "templateId" TEXT NOT NULL,
    "transactionType" "FinancialTransactionType" NOT NULL,
    "perTransactionMaxRwf" INTEGER,
    "dailyMaxRwf" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LimitRoleTemplateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LimitRoleTemplate_templateCode_key" ON "LimitRoleTemplate"("templateCode");

-- CreateIndex
CREATE INDEX "LimitRoleTemplate_templateName_idx" ON "LimitRoleTemplate"("templateName");

-- CreateIndex
CREATE INDEX "LimitRoleTemplate_isActive_idx" ON "LimitRoleTemplate"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LimitRoleTemplateLimit_templateId_transactionType_key" ON "LimitRoleTemplateLimit"("templateId", "transactionType");

-- CreateIndex
CREATE INDEX "LimitRoleTemplateLimit_transactionType_isActive_idx" ON "LimitRoleTemplateLimit"("transactionType", "isActive");

-- AddForeignKey
ALTER TABLE "LimitRoleTemplateLimit" ADD CONSTRAINT "LimitRoleTemplateLimit_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "LimitRoleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
