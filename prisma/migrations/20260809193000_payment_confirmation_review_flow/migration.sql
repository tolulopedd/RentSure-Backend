CREATE TYPE "PaymentConfirmationOutcome" AS ENUM ('FULL', 'PARTIAL');

ALTER TYPE "PublicNotificationType" ADD VALUE 'PAYMENT_UPDATE';

ALTER TABLE "PaymentSchedule"
ADD COLUMN "confirmationOutcome" "PaymentConfirmationOutcome";
