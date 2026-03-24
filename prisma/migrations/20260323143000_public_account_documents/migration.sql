CREATE TYPE "PublicDocumentType" AS ENUM (
  'PASSPORT_PHOTO',
  'IDENTITY_DOCUMENT',
  'EMPLOYMENT_DOCUMENT',
  'PAYSLIP',
  'UTILITY_BILL',
  'PAYMENT_RECEIPT',
  'OTHER'
);

ALTER TABLE "PublicAccount"
ADD COLUMN "passportPhotoDocumentId" TEXT;

CREATE TABLE "PublicAccountDocument" (
  "id" TEXT NOT NULL,
  "publicAccountId" TEXT NOT NULL,
  "documentType" "PublicDocumentType" NOT NULL,
  "fileName" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PublicAccountDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicAccountDocument_objectKey_key" ON "PublicAccountDocument"("objectKey");
CREATE INDEX "PublicAccount_passportPhotoDocumentId_idx" ON "PublicAccount"("passportPhotoDocumentId");
CREATE INDEX "PublicAccountDocument_publicAccountId_documentType_createdAt_idx" ON "PublicAccountDocument"("publicAccountId", "documentType", "createdAt");

ALTER TABLE "PublicAccount"
ADD CONSTRAINT "PublicAccount_passportPhotoDocumentId_fkey"
FOREIGN KEY ("passportPhotoDocumentId") REFERENCES "PublicAccountDocument"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PublicAccountDocument"
ADD CONSTRAINT "PublicAccountDocument_publicAccountId_fkey"
FOREIGN KEY ("publicAccountId") REFERENCES "PublicAccount"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
