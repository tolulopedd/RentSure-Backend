/*
  Warnings:

  - A unique constraint covering the columns `[agencyCustomerId]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[accountNumber]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "CustomerTitle" AS ENUM ('MR', 'MRS', 'MISS');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "accountNumber" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "agencyCustomerId" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "idCopyUri" TEXT,
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "idType" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "photoUri" TEXT,
ADD COLUMN     "title" "CustomerTitle";

-- CreateTable
CREATE TABLE "SystemCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemCounter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_agencyCustomerId_key" ON "Customer"("agencyCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_accountNumber_key" ON "Customer"("accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "Customer_firstName_lastName_idx" ON "Customer"("firstName", "lastName");
