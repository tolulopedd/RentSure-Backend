-- AlterTable
ALTER TABLE "Property"
ADD COLUMN "ownerName" TEXT,
ADD COLUMN "landlordEmail" TEXT,
ADD COLUMN "unitCount" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "PropertyUnit" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyUnit_pkey" PRIMARY KEY ("id")
);

-- Backfill ownerName and landlordEmail from the linked landlord account where available,
-- otherwise fall back to the property creator so existing rows stay valid.
UPDATE "Property" p
SET
  "ownerName" = COALESCE(
    (
      SELECT COALESCE(NULLIF(pa."organizationName", ''), NULLIF(TRIM(CONCAT(pa."firstName", ' ', pa."lastName")), ''))
      FROM "PropertyMember" pm
      INNER JOIN "PublicAccount" pa ON pa."id" = pm."publicAccountId"
      WHERE pm."propertyId" = p."id" AND pm."role" = 'LANDLORD'
      ORDER BY pm."isPrimary" DESC, pm."addedAt" ASC
      LIMIT 1
    ),
    (
      SELECT COALESCE(NULLIF(creator."organizationName", ''), NULLIF(TRIM(CONCAT(creator."firstName", ' ', creator."lastName")), ''))
      FROM "PublicAccount" creator
      WHERE creator."id" = p."createdByAccountId"
      LIMIT 1
    ),
    'Property owner'
  ),
  "landlordEmail" = COALESCE(
    (
      SELECT pa."email"
      FROM "PropertyMember" pm
      INNER JOIN "PublicAccount" pa ON pa."id" = pm."publicAccountId"
      WHERE pm."propertyId" = p."id" AND pm."role" = 'LANDLORD'
      ORDER BY pm."isPrimary" DESC, pm."addedAt" ASC
      LIMIT 1
    ),
    (
      SELECT creator."email"
      FROM "PublicAccount" creator
      WHERE creator."id" = p."createdByAccountId"
      LIMIT 1
    ),
    'unknown@rentsure.local'
  );

ALTER TABLE "Property"
ALTER COLUMN "ownerName" SET NOT NULL,
ALTER COLUMN "landlordEmail" SET NOT NULL;

-- Seed one default unit for existing properties so every property has at least one linked address.
INSERT INTO "PropertyUnit" ("id", "propertyId", "label", "address", "state", "city", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  'Unit 1',
  p."address",
  p."state",
  p."city",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Property" p
WHERE NOT EXISTS (
  SELECT 1 FROM "PropertyUnit" pu WHERE pu."propertyId" = p."id"
);

-- CreateIndex
CREATE INDEX "Property_landlordEmail_idx" ON "Property"("landlordEmail");

-- CreateIndex
CREATE INDEX "PropertyUnit_propertyId_createdAt_idx" ON "PropertyUnit"("propertyId", "createdAt");

-- AddForeignKey
ALTER TABLE "PropertyUnit"
ADD CONSTRAINT "PropertyUnit_propertyId_fkey"
FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
