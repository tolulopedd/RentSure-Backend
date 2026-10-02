import assert from "node:assert/strict";
import { prisma } from "../prisma/client";
import {
  buildRentScoreSnapshot,
  ensureRegistrationRentScoreEvent,
  getAuthenticatedRenterScore,
  getRentScoreConfig,
  getRenterScoreDetails,
  recordRentScoreEvent,
  replaceRentScoreEventsByCodes
} from "../modules/rent-score/rent-score.service";
import { getWorkspaceQueueItem, listWorkspaceQueue } from "../modules/workspace/workspace.service";

const email = `rent-score-test-${Date.now()}@example.com`;
const results: Array<{
  test: string;
  event: string;
  expectedChange: number;
  actualChange: number;
  expectedFinal: number;
  actualFinal: number;
  status: "PASS" | "FAIL";
}> = [];

function addResult(test: string, event: string, before: number, after: number, expectedChange: number, expectedFinal: number) {
  const actualChange = after - before;
  const pass = actualChange === expectedChange && after === expectedFinal;
  results.push({
    test,
    event,
    expectedChange,
    actualChange,
    expectedFinal,
    actualFinal: after,
    status: pass ? "PASS" : "FAIL"
  });
  assert.equal(actualChange, expectedChange, `${test}: score change mismatch`);
  assert.equal(after, expectedFinal, `${test}: final score mismatch`);
}

async function snapshot(accountId: string) {
  return buildRentScoreSnapshot(accountId);
}

async function main() {
  let accountId: string | null = null;
  let propertyId: string | null = null;
  let landlordId: string | null = null;
  let secondLandlordId: string | null = null;
  let agentId: string | null = null;
  let outsiderLandlordId: string | null = null;

  try {
    const now = new Date();
    const account = await prisma.publicAccount.create({
      data: {
        accountType: "RENTER",
        entityType: "INDIVIDUAL",
        firstName: "S",
        lastName: "T",
        email,
        passwordHash: "test-only",
        phone: "",
        state: "",
        city: "",
        address: "",
        status: "ACTIVE",
        acceptedTermsAt: now
      }
    });
    accountId = account.id;

    const adminConfig = await getRentScoreConfig();
    const expectedRuleCodes = [
      "REGISTRATION_COMPLETED", "EMAIL_VERIFIED", "PHONE_UPDATED", "GOVERNMENT_ID_VERIFIED", "COMPLETE_PROFILE",
      "RENT_PAID_ON_OR_BEFORE_DUE_DATE", "RENT_PAID_WITHIN_GRACE_PERIOD", "RENT_MISSED",
      "UTILITY_PAID_ON_TIME", "UTILITY_PAID_WITHIN_GRACE_PERIOD", "UTILITY_MISSED",
      "PROPERTY_MAINTENANCE_EXCELLENT", "PROPERTY_MAINTENANCE_GOOD", "PROPERTY_MAINTENANCE_POOR",
      "LEASE_COMPLIANCE_EXCELLENT", "LEASE_COMPLIANCE_GOOD", "LEASE_COMPLIANCE_POOR",
      "RENTAL_STABILITY_1_MOVE", "RENTAL_STABILITY_2_MOVES", "RENTAL_STABILITY_3_PLUS_MOVES",
      "EMPLOYED_1_YEAR", "EMPLOYED_2_YEARS", "EMPLOYED_3_PLUS_YEARS",
      "SELF_EMPLOYED_5_PLUS_YEARS", "SELF_EMPLOYED_3_TO_4_YEARS", "SELF_EMPLOYED_UNDER_3_YEARS",
      "LANDLORD_REFERENCE_STRONGLY_RECOMMEND", "LANDLORD_REFERENCE_RECOMMEND", "LANDLORD_REFERENCE_NEUTRAL", "LANDLORD_REFERENCE_DO_NOT_RECOMMEND",
      "RENTER_BAND_D", "RENTER_BAND_C", "RENTER_BAND_B", "RENTER_BAND_A"
    ];
    const configuredCodes = new Set(adminConfig.rules.map((rule: any) => rule.code));
    assert.equal(adminConfig.maxScore, 900, "Admin policy must cap scores at 900");
    assert.equal(expectedRuleCodes.every((code) => configuredCodes.has(code)), true, "Every scoring event must exist in Admin configuration");
    console.table(adminConfig.rules.map((rule: any) => ({ code: rule.code, points: rule.points, active: rule.isActive })));
    results.push({ test: "Admin rule configuration", event: "All configured scoring rules loaded", expectedChange: expectedRuleCodes.length, actualChange: expectedRuleCodes.filter((code) => configuredCodes.has(code)).length, expectedFinal: 900, actualFinal: adminConfig.maxScore, status: "PASS" });

    const createWorkspaceAccount = async (accountType: "LANDLORD" | "AGENT") => {
      const created = await prisma.publicAccount.create({
        data: {
          accountType,
          entityType: "INDIVIDUAL",
          firstName: accountType === "LANDLORD" ? "Landlord" : "Agent",
          lastName: "Test",
          email: `rent-score-${accountType.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
          passwordHash: "test-only",
          phone: "09000000001",
          state: "Lagos",
          city: "Ikeja",
          address: "No 2 Test Street",
          status: "ACTIVE",
          acceptedTermsAt: now,
          emailVerifiedAt: now
        }
      });
      return created.id;
    };

    landlordId = await createWorkspaceAccount("LANDLORD");
    secondLandlordId = await createWorkspaceAccount("LANDLORD");
    agentId = await createWorkspaceAccount("AGENT");
    outsiderLandlordId = await createWorkspaceAccount("LANDLORD");

    let current = await snapshot(account.id);
    addResult("Starting score", "No verified profile events", 0, current.summary.score, 0, 0);

    await prisma.publicAccount.update({
      where: { id: account.id },
      data: { emailVerifiedAt: now }
    });
    await ensureRegistrationRentScoreEvent(account.id);
    current = await snapshot(account.id);
    addResult("Account activation", "Email verified + account activated", 0, current.summary.score, 40, 40);

    await prisma.publicAccount.update({
      where: { id: account.id },
      data: {
        firstName: "Score",
        lastName: "Test",
        phone: "09000000000",
        state: "Lagos",
        city: "Ikeja",
        address: "No 1 Test Street"
      }
    });
    const beforeProfile = current.summary.score;
    current = await snapshot(account.id);
    addResult("Profile completion", "Phone + core address details", beforeProfile, current.summary.score, 40, 80);

    await prisma.publicAccount.update({
      where: { id: account.id },
      data: {
        identityReviewStatus: "APPROVED",
        identityReviewedAt: now,
        nin: "12345678901",
        ninVerifiedAt: now,
        residenceMoveCount5y: 1,
        employmentType: "EMPLOYED",
        employmentYears: 1
      }
    });
    const beforeIdentity = current.summary.score;
    current = await snapshot(account.id);
    addResult("Identity and profile", "Government ID + 1 move + employed 1 year", beforeIdentity, current.summary.score, 220, 300);

    const property = await prisma.property.create({
      data: {
        name: "Rent score test property",
        ownerName: "Score Test",
        landlordEmail: email,
        address: "No 1 Test Street",
        state: "Lagos",
        city: "Ikeja",
        propertyType: "Flats",
        createdByAccountId: landlordId,
        units: {
          create: {
            label: "Flat 1",
            address: "No 1 Test Street",
            state: "Lagos",
            city: "Ikeja",
            bedroomCount: 2,
            bathroomCount: 2,
            annualRentAmountNgn: 1_200_000
          }
        }
      },
      include: { units: true }
    });
    propertyId = property.id;
    const unit = property.units[0];
    await prisma.propertyMember.createMany({
      data: [
        { propertyId: property.id, publicAccountId: landlordId, role: "LANDLORD", isPrimary: true },
        { propertyId: property.id, publicAccountId: secondLandlordId, role: "LANDLORD", isPrimary: false },
        { propertyId: property.id, publicAccountId: agentId, role: "AGENT", isPrimary: false }
      ]
    });
    const proposed = await prisma.proposedRenter.create({
      data: {
        propertyId: property.id,
        propertyUnitId: unit.id,
        renterAccountId: account.id,
        requestedByAccountId: landlordId,
        firstName: "Score",
        lastName: "Test",
        email,
        phone: "09000000000",
        address: "No 1 Test Street",
        city: "Ikeja",
        state: "Lagos",
        renterLinkResponseStatus: "ACCEPTED",
        decision: "APPROVED"
      }
    });

    const beforeBand = current.summary.score;
    current = await snapshot(account.id);
    addResult("Renter band", "Approved unit at ₦1,200,000", beforeBand, current.summary.score, 75, 375);

    const renterView = await getAuthenticatedRenterScore(account.id);
    const adminView = await getRenterScoreDetails(account.id);
    const landlordView = await getWorkspaceQueueItem(landlordId, proposed.id);
    const secondLandlordView = await getWorkspaceQueueItem(secondLandlordId, proposed.id);
    const agentView = await getWorkspaceQueueItem(agentId, proposed.id);
    const outsiderItems = await listWorkspaceQueue(outsiderLandlordId);
    let outsiderDenied = false;
    try {
      await getWorkspaceQueueItem(outsiderLandlordId, proposed.id);
    } catch {
      outsiderDenied = true;
    }
    assert.equal(renterView.summary.score, current.summary.score, "Renter score view must match calculation");
    assert.equal(adminView.summary.score, current.summary.score, "Admin score view must match calculation");
    assert.equal(landlordView.linkedRentScore?.score, current.summary.score, "Authorized landlord must see the calculated score");
    assert.equal(secondLandlordView.linkedRentScore?.score, current.summary.score, "Second authorized landlord must see the same score");
    assert.equal(agentView.linkedRentScore, null, "Agent must not see renter score");
    assert.equal(outsiderItems.items.length, 0, "Unrelated landlord must not list the renter");
    assert.equal(outsiderDenied, true, "Unrelated landlord must not open the renter application");
    results.push({ test: "Cross-role score consistency", event: "Admin -> renter -> authorized landlords", expectedChange: 0, actualChange: 0, expectedFinal: current.summary.score, actualFinal: landlordView.linkedRentScore?.score ?? -1, status: "PASS" });
    results.push({ test: "Unauthorized landlord access", event: "Unrelated landlord application lookup", expectedChange: 0, actualChange: 0, expectedFinal: 0, actualFinal: outsiderItems.items.length, status: "PASS" });
    results.push({ test: "Agent score authorization", event: "Agent opens linked application", expectedChange: 0, actualChange: 0, expectedFinal: 0, actualFinal: agentView.linkedRentScore ? 1 : 0, status: "PASS" });

    const beforeMaintenance = current.summary.score;
    await recordRentScoreEvent({ publicAccountId: account.id, ruleCode: "PROPERTY_MAINTENANCE_EXCELLENT" });
    current = await snapshot(account.id);
    addResult("Behaviour maintenance", "Excellent", beforeMaintenance, current.summary.score, 100, 475);

    const beforeDuplicate = current.summary.score;
    await recordRentScoreEvent({ publicAccountId: account.id, ruleCode: "PROPERTY_MAINTENANCE_EXCELLENT" });
    current = await snapshot(account.id);
    addResult("Duplicate event", "Repeated maintenance Excellent", beforeDuplicate, current.summary.score, 0, 475);

    const beforeCompliance = current.summary.score;
    await recordRentScoreEvent({ publicAccountId: account.id, ruleCode: "LEASE_COMPLIANCE_EXCELLENT" });
    current = await snapshot(account.id);
    addResult("Lease compliance", "Excellent", beforeCompliance, current.summary.score, 100, 575);

    const beforeReference = current.summary.score;
    await recordRentScoreEvent({ publicAccountId: account.id, ruleCode: "LANDLORD_REFERENCE_STRONGLY_RECOMMEND" });
    current = await snapshot(account.id);
    addResult("Landlord reference", "Strongly recommend", beforeReference, current.summary.score, 100, 675);

    const beforeRent = current.summary.score;
    await prisma.paymentSchedule.create({
      data: {
        proposedRenterId: proposed.id,
        propertyId: property.id,
        createdByAccountId: account.id,
        paymentType: "RENT",
        amountNgn: 100_000,
        dueDate: new Date(now.getTime() - 86_400_000),
        status: "PAID",
        paidAt: new Date(now.getTime() - 86_400_000)
      }
    });
    current = await snapshot(account.id);
    addResult("Rent payment", "Paid on time", beforeRent, current.summary.score, 200, 875);

    const rentRule = await prisma.rentScoreRule.findFirstOrThrow({ where: { code: "RENT_PAID_ON_OR_BEFORE_DUE_DATE" } });
    const originalRentPoints = rentRule.points;
    try {
      await prisma.rentScoreRule.update({ where: { id: rentRule.id }, data: { points: 180 } });
      const beforeMaintainedPoints = current.summary.score;
      current = await snapshot(account.id);
      addResult("Maintained rule points", "Rent on-time points changed 200 -> 180", beforeMaintainedPoints, current.summary.score, -20, 855);
    } finally {
      await prisma.rentScoreRule.update({ where: { id: rentRule.id }, data: { points: originalRentPoints } });
    }
    current = await snapshot(account.id);
    assert.equal(current.summary.score, 875, "Restoring maintained points should restore the score");
    results.push({
      test: "Rule point restoration",
      event: "Rent on-time points restored",
      expectedChange: 20,
      actualChange: 20,
      expectedFinal: 875,
      actualFinal: current.summary.score,
      status: "PASS"
    });

    const beforeUtility = current.summary.score;
    await prisma.paymentSchedule.create({
      data: {
        proposedRenterId: proposed.id,
        propertyId: property.id,
        createdByAccountId: account.id,
        paymentType: "UTILITY",
        amountNgn: 20_000,
        dueDate: new Date(now.getTime() - 86_400_000),
        status: "PAID",
        paidAt: new Date(now.getTime() - 86_400_000)
      }
    });
    current = await snapshot(account.id);
    addResult("Utility payment", "Paid on time", beforeUtility, current.summary.score, 25, 900);

    const deterministicFirst = await snapshot(account.id);
    const deterministicSecond = await snapshot(account.id);
    assert.deepEqual(
      {
        score: deterministicSecond.summary.score,
        maxScore: deterministicSecond.summary.maxScore,
        breakdown: deterministicSecond.breakdown.map((item: any) => ({
          categoryCode: item.categoryCode,
          code: item.code,
          contribution: item.contribution,
          quantity: item.quantity
        }))
      },
      {
        score: deterministicFirst.summary.score,
        maxScore: deterministicFirst.summary.maxScore,
        breakdown: deterministicFirst.breakdown.map((item: any) => ({
          categoryCode: item.categoryCode,
          code: item.code,
          contribution: item.contribution,
          quantity: item.quantity
        }))
      },
      "Repeated recalculation must produce the same scoring outputs"
    );
    results.push({
      test: "Deterministic recalculation",
      event: "Same data recalculated twice",
      expectedChange: 0,
      actualChange: deterministicSecond.summary.score - deterministicFirst.summary.score,
      expectedFinal: deterministicFirst.summary.score,
      actualFinal: deterministicSecond.summary.score,
      status: "PASS"
    });

    await prisma.propertyUnit.update({ where: { id: unit.id }, data: { annualRentAmountNgn: 3_000_000 } });
    const beforeMax = current.summary.score;
    current = await snapshot(account.id);
    addResult("Maximum score", "Band A remains capped at 900", beforeMax, current.summary.score, 0, 900);
    assert.equal(current.summary.maxScore, 900, "Configured maximum must be 900");

    const rent = await prisma.paymentSchedule.findFirstOrThrow({ where: { proposedRenterId: proposed.id, paymentType: "RENT" } });
    await prisma.paymentSchedule.update({
      where: { id: rent.id },
      data: { dueDate: new Date(now.getTime() - 60 * 86_400_000), paidAt: now }
    });
    current = await snapshot(account.id);
    addResult("Rent grace boundary", "Paid exactly 60 days late", 900, current.summary.score, 0, 900);

    await prisma.paymentSchedule.update({
      where: { id: rent.id },
      data: { dueDate: new Date(now.getTime() - 61 * 86_400_000), paidAt: now }
    });
    current = await snapshot(account.id);
    addResult("Rent missed boundary", "Paid 61 days late", 900, current.summary.score, -100, 800);

    await replaceRentScoreEventsByCodes({
      publicAccountId: account.id,
      codes: ["PROPERTY_MAINTENANCE_EXCELLENT", "PROPERTY_MAINTENANCE_GOOD", "PROPERTY_MAINTENANCE_POOR"],
      newEvent: null
    });
    current = await snapshot(account.id);
    assert.equal(current.summary.score, 700, "Event reversal should remove the maintenance contribution");
    results.push({ test: "Event reversal", event: "Remove maintenance event", expectedChange: -100, actualChange: -100, expectedFinal: 700, actualFinal: current.summary.score, status: "PASS" });

    const oldEventAt = new Date(now.getTime() - 10_000);
    const newEventAt = new Date(now.getTime() - 5_000);
    await recordRentScoreEvent({ publicAccountId: account.id, ruleCode: "PROPERTY_MAINTENANCE_POOR", occurredAt: newEventAt });
    await recordRentScoreEvent({ publicAccountId: account.id, ruleCode: "PROPERTY_MAINTENANCE_EXCELLENT", occurredAt: oldEventAt });
    current = await snapshot(account.id);
    assert.equal(current.breakdown.find((item: any) => item.categoryCode === "RENTER_BEHAVIOUR" && item.ruleId.includes("maintenance"))?.code, "PROPERTY_MAINTENANCE_POOR", "Latest historical event should win");
    results.push({ test: "Historical ordering", event: "Newer Poor overrides older Excellent", expectedChange: 0, actualChange: 0, expectedFinal: current.summary.score, actualFinal: current.summary.score, status: "PASS" });

    const invalid = await recordRentScoreEvent({ publicAccountId: account.id, ruleCode: "NOT_A_REAL_RULE" }).then(() => false).catch(() => true);
    assert.equal(invalid, true, "Invalid rule codes must be rejected");
    results.push({ test: "Invalid event", event: "Unknown rule code", expectedChange: 0, actualChange: 0, expectedFinal: current.summary.score, actualFinal: current.summary.score, status: "PASS" });

    const poorRule = await prisma.rentScoreRule.findFirstOrThrow({ where: { code: "PROPERTY_MAINTENANCE_POOR" } });
    const originalPoorPoints = poorRule.points;
    try {
      await prisma.rentScoreRule.update({ where: { id: poorRule.id }, data: { points: -100, isActive: true } });
      const beforeNegative = current.summary.score;
      current = await snapshot(account.id);
      addResult("Negative scoring event", "Poor maintenance configured at -100", beforeNegative, current.summary.score, -100, 600);
    } finally {
      await prisma.rentScoreRule.update({ where: { id: poorRule.id }, data: { points: originalPoorPoints } });
    }
    current = await snapshot(account.id);

    const legacyDamageRule = await prisma.rentScoreRule.findFirst({ where: { code: "DAMAGES_REPORTED" } });
    if (legacyDamageRule) {
      const beforeLegacyNegative = current.summary.score;
      await recordRentScoreEvent({ publicAccountId: account.id, ruleId: legacyDamageRule.id });
      current = await snapshot(account.id);
      addResult("Disabled negative event", "Legacy DAMAGES_REPORTED event", beforeLegacyNegative, current.summary.score, 0, beforeLegacyNegative);
    }

    const complianceRule = await prisma.rentScoreRule.findFirstOrThrow({ where: { code: "LEASE_COMPLIANCE_EXCELLENT" } });
    await prisma.rentScoreRule.update({ where: { id: complianceRule.id }, data: { isActive: false } });
    const beforeInactive = current.summary.score;
    current = await snapshot(account.id);
    addResult("Inactive rule", "Disabled Lease compliance Excellent rule", beforeInactive, current.summary.score, -100, beforeInactive - 100);
    await prisma.rentScoreRule.update({ where: { id: complianceRule.id }, data: { isActive: true } });

    console.table(results);
    if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
  } finally {
    if (accountId) await prisma.publicAccount.delete({ where: { id: accountId } }).catch(() => undefined);
    for (const id of [landlordId, secondLandlordId, agentId, outsiderLandlordId]) {
      if (id) await prisma.publicAccount.delete({ where: { id } }).catch(() => undefined);
    }
    if (propertyId) await prisma.property.delete({ where: { id: propertyId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

