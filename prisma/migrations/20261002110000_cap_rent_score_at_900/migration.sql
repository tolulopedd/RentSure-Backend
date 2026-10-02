UPDATE "RentScorePolicy"
SET "maxScore" = 900
WHERE "code" = 'DEFAULT'
  AND "maxScore" > 900;

