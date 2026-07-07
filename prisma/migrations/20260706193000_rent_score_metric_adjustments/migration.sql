CREATE TYPE "EmploymentType" AS ENUM ('EMPLOYED', 'SELF_EMPLOYED');

ALTER TABLE "PublicAccount"
ADD COLUMN "employmentType" "EmploymentType",
ADD COLUMN "employmentYears" INTEGER;
