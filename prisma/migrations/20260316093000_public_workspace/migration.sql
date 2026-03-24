-- CreateEnum
CREATE TYPE "PropertyMemberRole" AS ENUM ('LANDLORD', 'AGENT');

-- CreateEnum
CREATE TYPE "ProposedRenterStatus" AS ENUM ('PROPOSED', 'SCORE_REQUESTED', 'SCORE_SHARED', 'UNDER_REVIEW', 'DECISION_READY');

-- CreateEnum
CREATE TYPE "ScoreRequestStatus" AS ENUM ('REQUESTED', 'FORWARDED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "PaymentScheduleType" AS ENUM ('RENT', 'UTILITY', 'ESTATE_DUE');

-- CreateEnum
CREATE TYPE "PaymentScheduleStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "propertyType" TEXT,
    "createdByAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyMember" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "publicAccountId" TEXT NOT NULL,
    "role" "PropertyMemberRole" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposedRenter" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "renterAccountId" TEXT,
    "requestedByAccountId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "organizationName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "status" "ProposedRenterStatus" NOT NULL DEFAULT 'PROPOSED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposedRenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreRequest" (
    "id" TEXT NOT NULL,
    "proposedRenterId" TEXT NOT NULL,
    "requestedByAccountId" TEXT NOT NULL,
    "forwardedToAccountId" TEXT,
    "status" "ScoreRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "forwardedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ScoreRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSchedule" (
    "id" TEXT NOT NULL,
    "proposedRenterId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "paymentType" "PaymentScheduleType" NOT NULL,
    "amountNgn" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "PaymentScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_createdByAccountId_idx" ON "Property"("createdByAccountId");

-- CreateIndex
CREATE INDEX "Property_state_city_idx" ON "Property"("state", "city");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyMember_propertyId_publicAccountId_role_key" ON "PropertyMember"("propertyId", "publicAccountId", "role");

-- CreateIndex
CREATE INDEX "PropertyMember_publicAccountId_idx" ON "PropertyMember"("publicAccountId");

-- CreateIndex
CREATE INDEX "ProposedRenter_propertyId_status_idx" ON "ProposedRenter"("propertyId", "status");

-- CreateIndex
CREATE INDEX "ProposedRenter_renterAccountId_idx" ON "ProposedRenter"("renterAccountId");

-- CreateIndex
CREATE INDEX "ProposedRenter_requestedByAccountId_idx" ON "ProposedRenter"("requestedByAccountId");

-- CreateIndex
CREATE INDEX "ProposedRenter_email_idx" ON "ProposedRenter"("email");

-- CreateIndex
CREATE INDEX "ScoreRequest_proposedRenterId_createdAt_idx" ON "ScoreRequest"("proposedRenterId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoreRequest_requestedByAccountId_idx" ON "ScoreRequest"("requestedByAccountId");

-- CreateIndex
CREATE INDEX "ScoreRequest_forwardedToAccountId_idx" ON "ScoreRequest"("forwardedToAccountId");

-- CreateIndex
CREATE INDEX "PaymentSchedule_proposedRenterId_dueDate_idx" ON "PaymentSchedule"("proposedRenterId", "dueDate");

-- CreateIndex
CREATE INDEX "PaymentSchedule_propertyId_dueDate_idx" ON "PaymentSchedule"("propertyId", "dueDate");

-- CreateIndex
CREATE INDEX "PaymentSchedule_createdByAccountId_idx" ON "PaymentSchedule"("createdByAccountId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMember" ADD CONSTRAINT "PropertyMember_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMember" ADD CONSTRAINT "PropertyMember_publicAccountId_fkey" FOREIGN KEY ("publicAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedRenter" ADD CONSTRAINT "ProposedRenter_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedRenter" ADD CONSTRAINT "ProposedRenter_renterAccountId_fkey" FOREIGN KEY ("renterAccountId") REFERENCES "PublicAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedRenter" ADD CONSTRAINT "ProposedRenter_requestedByAccountId_fkey" FOREIGN KEY ("requestedByAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreRequest" ADD CONSTRAINT "ScoreRequest_proposedRenterId_fkey" FOREIGN KEY ("proposedRenterId") REFERENCES "ProposedRenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreRequest" ADD CONSTRAINT "ScoreRequest_requestedByAccountId_fkey" FOREIGN KEY ("requestedByAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreRequest" ADD CONSTRAINT "ScoreRequest_forwardedToAccountId_fkey" FOREIGN KEY ("forwardedToAccountId") REFERENCES "PublicAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_proposedRenterId_fkey" FOREIGN KEY ("proposedRenterId") REFERENCES "ProposedRenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "PublicAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
