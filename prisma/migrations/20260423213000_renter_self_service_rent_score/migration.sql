-- DropForeignKey
ALTER TABLE "RentScorePayment" DROP CONSTRAINT "RentScorePayment_proposedRenterId_fkey";

-- AlterTable
ALTER TABLE "RentScorePayment" ALTER COLUMN "proposedRenterId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "RentScorePayment" ADD CONSTRAINT "RentScorePayment_proposedRenterId_fkey" FOREIGN KEY ("proposedRenterId") REFERENCES "ProposedRenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
