CREATE TYPE "RentScoreOverrideScope" AS ENUM ('BREAKDOWN_ITEM', 'CATEGORY');

CREATE TABLE "RentScoreOverride" (
    "id" TEXT NOT NULL,
    "publicAccountId" TEXT NOT NULL,
    "scope" "RentScoreOverrideScope" NOT NULL,
    "targetCode" TEXT NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentScoreOverride_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RentScoreOverride_publicAccountId_isActive_scope_idx" ON "RentScoreOverride"("publicAccountId", "isActive", "scope");
CREATE INDEX "RentScoreOverride_createdByUserId_idx" ON "RentScoreOverride"("createdByUserId");
CREATE INDEX "RentScoreOverride_targetCode_isActive_idx" ON "RentScoreOverride"("targetCode", "isActive");

ALTER TABLE "RentScoreOverride" ADD CONSTRAINT "RentScoreOverride_publicAccountId_fkey" FOREIGN KEY ("publicAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RentScoreOverride" ADD CONSTRAINT "RentScoreOverride_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
