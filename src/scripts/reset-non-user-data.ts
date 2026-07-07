import { prisma } from "../prisma/client";

async function main() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.emailVerificationToken.deleteMany(),
    prisma.publicRefreshToken.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.proposedRenterActivity.deleteMany(),
    prisma.landlordReferenceRequest.deleteMany(),
    prisma.paymentSchedule.deleteMany(),
    prisma.scoreRequest.deleteMany(),
    prisma.rentScorePayment.deleteMany(),
    prisma.rentScoreOverride.deleteMany(),
    prisma.renterScoreShare.deleteMany(),
    prisma.publicAccountNotification.deleteMany(),
    prisma.publicAccountDocument.deleteMany({
      where: {
        documentType: {
          in: ["PAYMENT_RECEIPT", "UTILITY_BILL", "OTHER"]
        }
      }
    }),
    prisma.propertyMember.deleteMany(),
    prisma.propertyUnit.deleteMany(),
    prisma.proposedRenter.deleteMany(),
    prisma.property.deleteMany(),
    prisma.rentScoreEvent.deleteMany()
  ]);

  console.log("Reset complete: kept User and PublicAccount records, removed non-user transactional data.");
}

main()
  .catch((error) => {
    console.error("Reset failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
