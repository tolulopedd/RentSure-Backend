-- DropForeignKey
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CashRequest" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FloatLedger" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Outlet" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RefreshToken" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
