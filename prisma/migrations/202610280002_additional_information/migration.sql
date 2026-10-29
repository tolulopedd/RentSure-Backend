ALTER TABLE "ProposedRenter" ADD COLUMN "requestedInformation" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "additionalInformationResponse" JSONB;
