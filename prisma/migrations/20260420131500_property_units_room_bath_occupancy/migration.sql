-- AlterTable
ALTER TABLE "PropertyUnit"
ADD COLUMN "bedroomCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "bathroomCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "isOccupied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "currentTenantName" TEXT,
ADD COLUMN "currentTenantEmail" TEXT,
ADD COLUMN "currentTenantPhone" TEXT;
