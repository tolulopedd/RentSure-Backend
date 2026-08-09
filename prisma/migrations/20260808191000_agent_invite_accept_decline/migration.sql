CREATE TYPE "PropertyAgentInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

ALTER TABLE "PropertyAgentInvite"
ADD COLUMN "status" "PropertyAgentInviteStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "respondedAt" TIMESTAMP(3);

UPDATE "PropertyAgentInvite"
SET "status" = CASE
  WHEN "acceptedAt" IS NOT NULL THEN 'ACCEPTED'::"PropertyAgentInviteStatus"
  ELSE 'PENDING'::"PropertyAgentInviteStatus"
END,
"respondedAt" = "acceptedAt"
WHERE "status" = 'PENDING';
