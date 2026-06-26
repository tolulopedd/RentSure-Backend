CREATE TABLE "RentScoreCategoryConfig" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentScoreCategoryConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RentScoreCategoryConfig_policyId_code_key" ON "RentScoreCategoryConfig"("policyId", "code");
CREATE INDEX "RentScoreCategoryConfig_policyId_isActive_idx" ON "RentScoreCategoryConfig"("policyId", "isActive");
CREATE INDEX "RentScoreCategoryConfig_sortOrder_idx" ON "RentScoreCategoryConfig"("sortOrder");

ALTER TABLE "RentScoreCategoryConfig" ADD CONSTRAINT "RentScoreCategoryConfig_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "RentScorePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "RentScoreCategoryConfig" ("id", "policyId", "code", "name", "maxScore", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  v."code",
  v."name",
  v."maxScore",
  true,
  v."sortOrder",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "RentScorePolicy" p
CROSS JOIN (
  VALUES
    ('IDENTITY_VERIFICATION', 'Identity & Verification', 100, 10),
    ('PAYMENT', 'Payment (Rent & Utility)', 250, 20),
    ('RENTER_BEHAVIOUR', 'Renters Behaviour', 200, 30),
    ('RENTAL_STABILITY', 'Rental Stability', 75, 40),
    ('EMPLOYMENT_STABILITY', 'Employment Stability', 75, 50),
    ('LANDLORD_REFERENCE', 'Landlord References', 100, 60),
    ('RENTER_BAND', 'Renter Band', 100, 70)
) AS v("code", "name", "maxScore", "sortOrder")
ON CONFLICT ("policyId", "code") DO NOTHING;
