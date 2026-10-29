import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma/client";
import { env } from "../config/env";
import { buildRentScoreSnapshot, ensureDefaultRentScorePolicy } from "../modules/rent-score/rent-score.service";

async function main() {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname), "Local database required");
  const rollback = new Error("ROLLBACK_TEST");
  // All metric changes and fixtures remain uncommitted and are rolled back.
  await assert.rejects(() => prisma.$transaction(async db => {
    const policy = await ensureDefaultRentScorePolicy(db);
    assert.ok(policy);
    await db.rentScorePolicy.update({ where: { id: policy.id }, data: { minScore: 0, maxScore: 900 } });
    await db.rentScoreCategoryConfig.updateMany({ where: { policyId: policy.id }, data: { isActive: false } });
    const category = policy.categories.find(item => item.code === "IDENTITY_VERIFICATION")!;
    await db.rentScoreCategoryConfig.update({ where: { id: category.id }, data: { isActive: true, maxScore: 100 } });
    await db.rentScoreRule.updateMany({ where: { policyId: policy.id }, data: { isActive: false } });
    const rule = policy.rules.find(item => item.code === "PHONE_UPDATED")!;
    await db.rentScoreRule.update({ where: { id: rule.id }, data: { points: 20, isActive: true } });
    const ids: string[] = [];
    for (const status of ["ACTIVE", "UNVERIFIED", "DISABLED", "SUSPENDED", "BLOCKED"] as const) {
      const account = await db.publicAccount.create({ data: {
        accountType: "RENTER", entityType: "INDIVIDUAL", firstName: "Metric", lastName: status,
        email: "metric-" + randomUUID() + "@example.com", passwordHash: "test-only", phone: "09000000000",
        address: "", city: "", state: "", status, acceptedTermsAt: new Date()
      } });
      ids.push(account.id);
    }
    async function expectAll(score: number, label: string) {
      for (const id of ids) assert.equal((await buildRentScoreSnapshot(id, db)).summary.score, score, label + ": " + id);
      console.log("PASS " + label + " across all five account statuses");
    }
    await expectAll(20, "Baseline");
    await db.rentScoreRule.update({ where: { id: rule.id }, data: { points: 35 } });
    await expectAll(35, "Changed metric points apply without renter activity");
    await db.rentScoreCategoryConfig.update({ where: { id: category.id }, data: { maxScore: 25 } });
    await expectAll(25, "Category cap applies to all renters");
    await db.rentScoreRule.update({ where: { id: rule.id }, data: { isActive: false } });
    await expectAll(0, "Disabled metric removed from all scores");
    await db.rentScoreRule.update({ where: { id: rule.id }, data: { isActive: true } });
    await db.rentScoreCategoryConfig.update({ where: { id: category.id }, data: { isActive: false } });
    await expectAll(0, "Disabled category removed from all scores");
    throw rollback;
  }, { timeout: 60000 }), error => error === rollback);
  console.log("All score metric propagation checks passed; fixtures and metric changes rolled back.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
