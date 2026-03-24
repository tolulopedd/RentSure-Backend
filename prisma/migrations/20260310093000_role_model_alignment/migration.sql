-- Align staff and public account enums to the RentSure role model.

ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AGENT', 'LANDLORD', 'RENTER');

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole"
  USING (
    CASE
      WHEN "role"::text IN ('SUPER_ADMIN', 'SUPERVISOR', 'AUDITOR') THEN 'ADMIN'
      ELSE "role"::text
    END
  )::"UserRole";

ALTER TABLE "RoleTransactionLimit"
  ALTER COLUMN "role" TYPE "UserRole"
  USING (
    CASE
      WHEN "role"::text IN ('SUPER_ADMIN', 'SUPERVISOR', 'AUDITOR') THEN 'ADMIN'
      ELSE "role"::text
    END
  )::"UserRole";

DROP TYPE "UserRole_old";

ALTER TYPE "PublicAccountType" RENAME TO "PublicAccountType_old";
CREATE TYPE "PublicAccountType" AS ENUM ('RENTER', 'LANDLORD', 'AGENT');

ALTER TABLE "PublicAccount"
  ALTER COLUMN "accountType" TYPE "PublicAccountType"
  USING (
    CASE
      WHEN "accountType"::text = 'RENTER' THEN 'RENTER'
      WHEN COALESCE("representation", 'LANDLORD') = 'LANDLORD' THEN 'LANDLORD'
      ELSE 'AGENT'
    END
  )::"PublicAccountType";

DROP TYPE "PublicAccountType_old";

ALTER TYPE "PublicEntityType" RENAME TO "PublicEntityType_old";
CREATE TYPE "PublicEntityType" AS ENUM ('INDIVIDUAL', 'COMPANY');

ALTER TABLE "PublicAccount"
  ALTER COLUMN "entityType" TYPE "PublicEntityType"
  USING (
    CASE
      WHEN "entityType"::text = 'INDIVIDUAL' THEN 'INDIVIDUAL'
      ELSE 'COMPANY'
    END
  )::"PublicEntityType";

DROP TYPE "PublicEntityType_old";
