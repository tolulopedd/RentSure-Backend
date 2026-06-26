-- AlterTable
ALTER TABLE "PublicAccount"
ADD COLUMN "residenceMoveCount5y" INTEGER,
ADD COLUMN "employerCount5y" INTEGER;

-- AlterTable
ALTER TABLE "PropertyUnit"
ADD COLUMN "annualRentAmountNgn" INTEGER;
