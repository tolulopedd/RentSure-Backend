-- AlterTable
ALTER TABLE "Property"
ADD COLUMN "isOccupied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "currentTenantName" TEXT,
ADD COLUMN "currentTenantEmail" TEXT,
ADD COLUMN "currentTenantPhone" TEXT;
