import { prisma } from "../prisma/client";

async function main() {
  await prisma.$transaction([
    prisma.proposedRenterActivity.deleteMany(),
    prisma.paymentSchedule.deleteMany(),
    prisma.scoreRequest.deleteMany(),
    prisma.rentScorePayment.deleteMany(),
    prisma.renterScoreShare.deleteMany(),
    prisma.publicAccountNotification.deleteMany(),
    prisma.propertyMember.deleteMany(),
    prisma.propertyUnit.deleteMany(),
    prisma.proposedRenter.deleteMany(),
    prisma.property.deleteMany(),
    prisma.rentScoreEvent.deleteMany()
  ]);

  console.log("Reset complete: kept User and PublicAccount records, removed workspace/property/rent-score activity data.");
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
