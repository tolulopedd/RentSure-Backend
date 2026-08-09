-- CreateEnum
CREATE TYPE "ProposedRenterLinkResponseStatus" AS ENUM ('PENDING', 'ACCEPTED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "ProposedRenterActivityType" ADD VALUE IF NOT EXISTS 'LINK_ACCEPTED';
ALTER TYPE "ProposedRenterActivityType" ADD VALUE IF NOT EXISTS 'LINK_WITHDRAWN';

-- AlterEnum
ALTER TYPE "PublicNotificationType" ADD VALUE IF NOT EXISTS 'PROPERTY_LINK_RESPONSE';

-- AlterTable
ALTER TABLE "ProposedRenter"
ADD COLUMN "renterLinkResponseNote" TEXT,
ADD COLUMN "renterLinkRespondedAt" TIMESTAMP(3),
ADD COLUMN "renterLinkResponseStatus" "ProposedRenterLinkResponseStatus" NOT NULL DEFAULT 'PENDING';
