-- AlterTable
ALTER TABLE "ProposedRenter" ADD COLUMN "propertyUnitId" TEXT;

-- CreateIndex
CREATE INDEX "ProposedRenter_propertyUnitId_status_idx" ON "ProposedRenter"("propertyUnitId", "status");

-- AddForeignKey
ALTER TABLE "ProposedRenter"
ADD CONSTRAINT "ProposedRenter_propertyUnitId_fkey"
FOREIGN KEY ("propertyUnitId") REFERENCES "PropertyUnit"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
