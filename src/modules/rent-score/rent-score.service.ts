import type { Prisma, PublicAccountStatus, RentScoreOverrideScope } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { env } from "../../config/env";
import { renderTransactionalEmail } from "../mail/mail-templates";
import { sendTransactionalMail } from "../mail/mail.service";

const DEFAULT_POLICY_CODE = "DEFAULT";
const REGISTRATION_RULE_CODE = "REGISTRATION_COMPLETED";
const PROFILE_COMPLETED_RULE_CODE = "COMPLETE_PROFILE";
const PHONE_UPDATED_RULE_CODE = "PHONE_UPDATED";
const GOVERNMENT_ID_RULE_CODE = "GOVERNMENT_ID_VERIFIED";
const RENT_MISSED_RULE_CODE = "RENT_MISSED";
const UTILITY_MISSED_RULE_CODE = "UTILITY_MISSED";

const PROPERTY_MAINTENANCE_RATING_CODES = [
  "PROPERTY_MAINTENANCE_EXCELLENT",
  "PROPERTY_MAINTENANCE_GOOD",
  "PROPERTY_MAINTENANCE_POOR"
] as const;

const LEASE_COMPLIANCE_RATING_CODES = [
  "LEASE_COMPLIANCE_EXCELLENT",
  "LEASE_COMPLIANCE_GOOD",
  "LEASE_COMPLIANCE_POOR"
] as const;

const LANDLORD_REFERENCE_CODES = [
  "LANDLORD_REFERENCE_STRONGLY_RECOMMEND",
  "LANDLORD_REFERENCE_RECOMMEND",
  "LANDLORD_REFERENCE_NEUTRAL",
  "LANDLORD_REFERENCE_DO_NOT_RECOMMEND"
] as const;

const LEGACY_RULE_CODES = [
  "RENT_PAID_31_TO_90_DAYS_LATE",
  "RENT_PAID_OVER_90_DAYS_LATE",
  "UTILITY_NO_OUTSTANDING_DEBT",
  "UTILITY_MINOR_OUTSTANDING_DEBT",
  "UTILITY_SIGNIFICANT_OUTSTANDING_DEBT",
  "UTILITY_DISCONNECTION",
  "RENT_DEFAULTED_OR_EVICTED",
  "RENTAL_BEHAVIOUR_EXCELLENT",
  "RENTAL_BEHAVIOUR_GOOD",
  "RENTAL_BEHAVIOUR_FAIR",
  "RENTAL_BEHAVIOUR_POOR",
  "DAMAGES_REPORTED",
  "RENTAL_STABILITY_4_MOVES",
  "RENTAL_STABILITY_5_PLUS_MOVES",
  "EMPLOYMENT_STABILITY_1_EMPLOYER",
  "EMPLOYMENT_STABILITY_2_EMPLOYERS",
  "EMPLOYMENT_STABILITY_3_EMPLOYERS",
  "EMPLOYMENT_STABILITY_4_EMPLOYERS",
  "EMPLOYMENT_STABILITY_5_PLUS_EMPLOYERS"
] as const;

const DEFAULT_CATEGORY_DEFINITIONS = [
  { code: "IDENTITY_VERIFICATION", name: "Identity & Verification", maxScore: 100, sortOrder: 10 },
  { code: "PAYMENT", name: "Payment (Rent & Utility)", maxScore: 300, sortOrder: 20 },
  { code: "RENTER_BEHAVIOUR", name: "Renters Behaviour", maxScore: 200, sortOrder: 30 },
  { code: "RENTAL_STABILITY", name: "Rental Stability", maxScore: 100, sortOrder: 40 },
  { code: "EMPLOYMENT_STABILITY", name: "Employment Stability", maxScore: 100, sortOrder: 50 },
  { code: "LANDLORD_REFERENCE", name: "Landlord References", maxScore: 100, sortOrder: 60 },
  { code: "RENTER_BAND", name: "Renter Band", maxScore: 100, sortOrder: 70 }
] as const;

type CategoryCode = typeof DEFAULT_CATEGORY_DEFINITIONS[number]["code"];

type DefaultRuleDefinition = {
  code: string;
  name: string;
  description: string;
  points: number;
  maxOccurrences?: number | null;
  sortOrder: number;
  metadata?: Prisma.JsonObject;
};

type RentScoreSnapshot = Awaited<ReturnType<typeof buildRentScoreSnapshot>>;
type DbClient = typeof prisma | Prisma.TransactionClient;

function publicAccountDisplayName(account: {
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
  email?: string | null;
}) {
  if (account.organizationName?.trim()) return account.organizationName.trim();
  const name = [account.firstName, account.lastName].filter(Boolean).join(" ").trim();
  return name || account.email || "RentSure user";
}

async function createPublicAccountNotification(input: {
  publicAccountId: string;
  notificationType: "IDENTITY_REVIEW";
  title: string;
  message: string;
  ctaLabel?: string;
  ctaPath?: string;
  metadata?: Prisma.JsonObject;
}) {
  await prisma.publicAccountNotification.create({
    data: {
      publicAccountId: input.publicAccountId,
      notificationType: input.notificationType,
      title: input.title,
      message: input.message,
      ctaLabel: input.ctaLabel ?? null,
      ctaPath: input.ctaPath ?? null,
      metadata: input.metadata
    }
  });
}

const defaultRuleDefinitions: DefaultRuleDefinition[] = [
  {
    code: REGISTRATION_RULE_CODE,
    name: "Account created",
    description: "Tracks the account-created milestone inside Identity & Verification.",
    points: 20,
    maxOccurrences: 1,
    sortOrder: 10
  },
  {
    code: "EMAIL_VERIFIED",
    name: "Email verified",
    description: "Tracks the email verification milestone inside Identity & Verification.",
    points: 20,
    maxOccurrences: 1,
    sortOrder: 20
  },
  {
    code: PHONE_UPDATED_RULE_CODE,
    name: "Phone updated",
    description: "Tracks when a renter has provided a phone number for the profile.",
    points: 20,
    maxOccurrences: 1,
    sortOrder: 30
  },
  {
    code: GOVERNMENT_ID_RULE_CODE,
    name: "Government ID verified",
    description: "Tracks when a renter verifies NIN or BVN on RentSure.",
    points: 20,
    maxOccurrences: 1,
    sortOrder: 40
  },
  {
    code: PROFILE_COMPLETED_RULE_CODE,
    name: "Complete profile",
    description: "Tracks when the renter profile has the required contact and address details.",
    points: 20,
    maxOccurrences: 1,
    sortOrder: 50
  },
  {
    code: "RENT_PAID_ON_OR_BEFORE_DUE_DATE",
    name: "Rent paid on time",
    description: "Rent paid on or before the due date.",
    points: 200,
    maxOccurrences: 1,
    sortOrder: 60
  },
  {
    code: "RENT_PAID_WITHIN_GRACE_PERIOD",
    name: "Rent paid within grace period (60 days)",
    description: "Rent paid within 60 days after the due date.",
    points: 150,
    maxOccurrences: 1,
    sortOrder: 70
  },
  {
    code: RENT_MISSED_RULE_CODE,
    name: "Rent missed",
    description: "Rent was missed or remains unpaid beyond the grace period.",
    points: 0,
    maxOccurrences: 1,
    sortOrder: 80
  },
  {
    code: "UTILITY_PAID_ON_TIME",
    name: "Utility paid on time",
    description: "Utility payment was made on or before the due date.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 90
  },
  {
    code: "UTILITY_PAID_WITHIN_GRACE_PERIOD",
    name: "Utility paid within grace period (60 days)",
    description: "Utility payment was made within 60 days after the due date.",
    points: 50,
    maxOccurrences: 1,
    sortOrder: 100
  },
  {
    code: UTILITY_MISSED_RULE_CODE,
    name: "Utility missed",
    description: "Utility payment was missed or remains unpaid beyond the grace period.",
    points: 0,
    maxOccurrences: 1,
    sortOrder: 110
  },
  {
    code: "PROPERTY_MAINTENANCE_EXCELLENT",
    name: "Property maintenance: Excellent",
    description: "Property maintenance was rated excellent.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 120
  },
  {
    code: "PROPERTY_MAINTENANCE_GOOD",
    name: "Property maintenance: Good",
    description: "Property maintenance was rated good.",
    points: 50,
    maxOccurrences: 1,
    sortOrder: 130
  },
  {
    code: "PROPERTY_MAINTENANCE_POOR",
    name: "Property maintenance: Poor",
    description: "Property maintenance was rated poor.",
    points: 0,
    maxOccurrences: 1,
    sortOrder: 140
  },
  {
    code: "LEASE_COMPLIANCE_EXCELLENT",
    name: "Lease compliance: Excellent",
    description: "General lease compliance was rated excellent.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 150
  },
  {
    code: "LEASE_COMPLIANCE_GOOD",
    name: "Lease compliance: Good",
    description: "General lease compliance was rated good.",
    points: 50,
    maxOccurrences: 1,
    sortOrder: 160
  },
  {
    code: "LEASE_COMPLIANCE_POOR",
    name: "Lease compliance: Poor",
    description: "General lease compliance was rated poor.",
    points: 0,
    maxOccurrences: 1,
    sortOrder: 170
  },
  {
    code: "RENTAL_STABILITY_1_MOVE",
    name: "1 move in last 5 years",
    description: "Renter moved once within the last five years.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 180
  },
  {
    code: "RENTAL_STABILITY_2_MOVES",
    name: "2 moves in last 5 years",
    description: "Renter moved twice within the last five years.",
    points: 60,
    maxOccurrences: 1,
    sortOrder: 190
  },
  {
    code: "RENTAL_STABILITY_3_PLUS_MOVES",
    name: "3 or more moves in last 5 years",
    description: "Renter moved three or more times within the last five years.",
    points: 0,
    maxOccurrences: 1,
    sortOrder: 200
  },
  {
    code: "EMPLOYED_1_YEAR",
    name: "Employed for 1 year",
    description: "Renter has been employed for 1 year.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 210
  },
  {
    code: "EMPLOYED_2_YEARS",
    name: "Employed for 2 years",
    description: "Renter has been employed for 2 years.",
    points: 60,
    maxOccurrences: 1,
    sortOrder: 220
  },
  {
    code: "EMPLOYED_3_PLUS_YEARS",
    name: "Employed for 3 or more years",
    description: "Renter has been employed for 3 or more years.",
    points: 0,
    maxOccurrences: 1,
    sortOrder: 230
  },
  {
    code: "SELF_EMPLOYED_5_PLUS_YEARS",
    name: "Self employed for 5 or more years",
    description: "Renter has been self employed for at least 5 years.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 240
  },
  {
    code: "SELF_EMPLOYED_3_TO_4_YEARS",
    name: "Self employed for 3 to 4 years",
    description: "Renter has been self employed for 3 to 4 years.",
    points: 60,
    maxOccurrences: 1,
    sortOrder: 250
  },
  {
    code: "SELF_EMPLOYED_UNDER_3_YEARS",
    name: "Self employed for under 3 years",
    description: "Renter has been self employed for less than 3 years.",
    points: 0,
    maxOccurrences: 1,
    sortOrder: 260
  },
  {
    code: "LANDLORD_REFERENCE_STRONGLY_RECOMMEND",
    name: "Landlord reference: Strongly recommend",
    description: "Latest verified landlord reference is strongly recommend.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 270
  },
  {
    code: "LANDLORD_REFERENCE_RECOMMEND",
    name: "Landlord reference: Recommend",
    description: "Latest verified landlord reference is recommend.",
    points: 75,
    maxOccurrences: 1,
    sortOrder: 280
  },
  {
    code: "LANDLORD_REFERENCE_NEUTRAL",
    name: "Landlord reference: Neutral",
    description: "Latest verified landlord reference is neutral.",
    points: 40,
    maxOccurrences: 1,
    sortOrder: 290
  },
  {
    code: "LANDLORD_REFERENCE_DO_NOT_RECOMMEND",
    name: "Landlord reference: Do not recommend",
    description: "Latest verified landlord reference is do not recommend.",
    points: 0,
    maxOccurrences: 1,
    sortOrder: 300
  },
  {
    code: "RENTER_BAND_D",
    name: "Band D (< 500,000)",
    description: "Property rent amount falls below 500,000.",
    points: 25,
    maxOccurrences: 1,
    sortOrder: 310
  },
  {
    code: "RENTER_BAND_C",
    name: "Band C (500,000 - 1M)",
    description: "Property rent amount falls between 500,000 and 1,000,000.",
    points: 50,
    maxOccurrences: 1,
    sortOrder: 320
  },
  {
    code: "RENTER_BAND_B",
    name: "Band B (1M - 2.5M)",
    description: "Property rent amount falls between 1,000,000 and 2,500,000.",
    points: 75,
    maxOccurrences: 1,
    sortOrder: 330
  },
  {
    code: "RENTER_BAND_A",
    name: "Band A (> 2.5M)",
    description: "Property rent amount is above 2,500,000.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 340
  }
];

const DEFAULT_RULE_CODES = new Set(defaultRuleDefinitions.map((rule) => rule.code));

type ScoreBand = "STRONG" | "STABLE" | "WATCH" | "RISK";

function normalizeRuleCode(raw: string) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function clampScore(value: number, minScore: number, maxScore: number) {
  return Math.min(maxScore, Math.max(minScore, value));
}

function scoreBand(score: number) {
  if (score >= 750) return "STRONG";
  if (score >= 500) return "STABLE";
  if (score >= 300) return "WATCH";
  return "RISK";
}

function hasValue(value?: string | null) {
  return Boolean(value?.trim());
}

function isProfileComplete(account: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  state: string;
  city: string;
  address: string;
}) {
  return [account.firstName, account.lastName, account.email, account.phone, account.state, account.city, account.address].every(hasValue);
}

function wholeDaysLate(dueDate: Date, paidAt: Date) {
  return Math.max(0, Math.floor((paidAt.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));
}

function groupSchedulesByYear<T extends { dueDate: Date }>(items: T[]) {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const year = item.dueDate.getFullYear();
    const current = grouped.get(year) ?? [];
    current.push(item);
    grouped.set(year, current);
  }
  return grouped;
}

function latestRelevantSchedule(
  schedules: Array<{
    dueDate: Date;
    status: string;
    confirmationOutcome?: "FULL" | "PARTIAL" | null;
    paidAt?: Date | null;
    confirmedAt?: Date | null;
    confirmedByRenterAt?: Date | null;
  }>,
  now: Date
) {
  return schedules
    .filter(
      (schedule) => schedule.status === "PAID" || schedule.confirmationOutcome === "PARTIAL" || schedule.dueDate <= now
    )
    .sort((left, right) => right.dueDate.getTime() - left.dueDate.getTime())[0] ?? null;
}

function paymentScoreFromLatestSchedule(
  schedule: {
    dueDate: Date;
    status: string;
    paidAt?: Date | null;
    confirmedAt?: Date | null;
    confirmedByRenterAt?: Date | null;
  } | null,
  input: {
    onTimePoints: number;
    withinGracePoints: number;
    gracePeriodDays: number;
  }
) {
  if (!schedule || schedule.status !== "PAID") {
    return 0;
  }

  const paidAt = schedule.paidAt ?? schedule.confirmedAt ?? schedule.confirmedByRenterAt;
  if (!paidAt) {
    return 0;
  }

  const daysLate = wholeDaysLate(schedule.dueDate, paidAt);
  if (daysLate <= 0) return input.onTimePoints;
  if (daysLate <= input.gracePeriodDays) return input.withinGracePoints;
  return 0;
}

function paymentRuleCodeFromLatestSchedule(
  schedule: {
    dueDate: Date;
    status: string;
    paidAt?: Date | null;
    confirmedAt?: Date | null;
    confirmedByRenterAt?: Date | null;
  } | null,
  input: {
    onTimeRuleCode: string;
    withinGraceRuleCode: string;
    missedRuleCode: string;
    gracePeriodDays: number;
  }
) {
  if (!schedule || schedule.status !== "PAID") {
    return schedule ? input.missedRuleCode : null;
  }

  const paidAt = schedule.paidAt ?? schedule.confirmedAt ?? schedule.confirmedByRenterAt;
  if (!paidAt) {
    return input.missedRuleCode;
  }

  const daysLate = wholeDaysLate(schedule.dueDate, paidAt);
  if (daysLate <= 0) return input.onTimeRuleCode;
  if (daysLate <= input.gracePeriodDays) return input.withinGraceRuleCode;
  return input.missedRuleCode;
}

function configuredRuleMap(
  rules: Array<{ code: string; points: number; isActive: boolean; name: string; description: string }>
) {
  return new Map(rules.map((rule) => [rule.code, rule] as const));
}

function configuredContribution(
  rule:
    | {
        code: string;
        points: number;
        isActive: boolean;
        name: string;
        description: string;
      }
    | null
    | undefined,
  isApplied: boolean
) {
  if (!rule || !rule.isActive || !isApplied) return 0;
  return rule.points;
}

function getLatestEventByCodes(
  events: Array<{
    occurredAt: Date;
    rule: { code: string; points: number; name: string; description?: string | null; isActive?: boolean };
  }>,
  codes: readonly string[]
) {
  return events.find((event) => codes.includes(event.rule.code));
}

function countEventOccurrencesByCode(
  events: Array<{ quantity: number; rule: { code: string } }>,
  code: string
) {
  return events
    .filter((event) => event.rule.code === code)
    .reduce((sum, event) => sum + Math.max(1, event.quantity || 1), 0);
}

function hasEventCode(events: Array<{ rule: { code: string } }>, code: string) {
  return events.some((event) => event.rule.code === code);
}

function clampCategoryScore(value: number, maxScore: number) {
  return Math.min(maxScore, value);
}

function isCategoryCode(value: string): value is CategoryCode {
  return DEFAULT_CATEGORY_DEFINITIONS.some((item) => item.code === value);
}

function inferRuleCategoryCode(code: string): CategoryCode | null {
  if ([REGISTRATION_RULE_CODE, "EMAIL_VERIFIED", PHONE_UPDATED_RULE_CODE, GOVERNMENT_ID_RULE_CODE, PROFILE_COMPLETED_RULE_CODE].includes(code)) {
    return "IDENTITY_VERIFICATION";
  }

  if (
    [
      "RENT_PAID_ON_OR_BEFORE_DUE_DATE",
      "RENT_PAID_WITHIN_GRACE_PERIOD",
      RENT_MISSED_RULE_CODE,
      "UTILITY_PAID_ON_TIME",
      "UTILITY_PAID_WITHIN_GRACE_PERIOD",
      UTILITY_MISSED_RULE_CODE,
      "RENT_PAYMENT_HISTORY",
      "UTILITY_PAYMENT_HISTORY"
    ].includes(code)
  ) {
    return "PAYMENT";
  }

  if (
    [...PROPERTY_MAINTENANCE_RATING_CODES, ...LEASE_COMPLIANCE_RATING_CODES].includes(
      code as (typeof PROPERTY_MAINTENANCE_RATING_CODES)[number] | (typeof LEASE_COMPLIANCE_RATING_CODES)[number]
    )
  ) {
    return "RENTER_BEHAVIOUR";
  }

  if (
    [
      "RENTAL_STABILITY",
      "RENTAL_STABILITY_1_MOVE",
      "RENTAL_STABILITY_2_MOVES",
      "RENTAL_STABILITY_3_PLUS_MOVES"
    ].includes(code)
  ) {
    return "RENTAL_STABILITY";
  }

  if (
    [
      "EMPLOYMENT_STABILITY",
      "EMPLOYED_1_YEAR",
      "EMPLOYED_2_YEARS",
      "EMPLOYED_3_PLUS_YEARS",
      "SELF_EMPLOYED_5_PLUS_YEARS",
      "SELF_EMPLOYED_3_TO_4_YEARS",
      "SELF_EMPLOYED_UNDER_3_YEARS"
    ].includes(code)
  ) {
    return "EMPLOYMENT_STABILITY";
  }

  if ([...LANDLORD_REFERENCE_CODES, "LANDLORD_REFERENCE_UNSET"].includes(code as (typeof LANDLORD_REFERENCE_CODES)[number] | "LANDLORD_REFERENCE_UNSET")) {
    return "LANDLORD_REFERENCE";
  }

  if (["RENTER_BAND", "RENTER_BAND_D", "RENTER_BAND_C", "RENTER_BAND_B", "RENTER_BAND_A"].includes(code)) {
    return "RENTER_BAND";
  }

  return null;
}

function calculateConfiguredCategoryPoints(
  categoryCode: CategoryCode,
  rules: Array<{ code: string; points: number; isActive?: boolean }>
) {
  const activeRules = rules.filter((rule) => rule.isActive !== false);

  if (categoryCode === "IDENTITY_VERIFICATION") {
    return activeRules.reduce((sum, rule) => sum + Math.max(rule.points, 0), 0);
  }

  if (categoryCode === "PAYMENT") {
    const rentCodes = [
      "RENT_PAID_ON_OR_BEFORE_DUE_DATE",
      "RENT_PAID_WITHIN_GRACE_PERIOD",
      RENT_MISSED_RULE_CODE
    ];
    const utilityCodes = [
      "UTILITY_PAID_ON_TIME",
      "UTILITY_PAID_WITHIN_GRACE_PERIOD",
      UTILITY_MISSED_RULE_CODE
    ];

    const maxRent = activeRules
      .filter((rule) => rentCodes.includes(rule.code))
      .reduce((max, rule) => Math.max(max, rule.points), 0);
    const maxUtility = activeRules
      .filter((rule) => utilityCodes.includes(rule.code))
      .reduce((max, rule) => Math.max(max, rule.points), 0);

    return Math.max(maxRent, 0) + Math.max(maxUtility, 0);
  }

  if (categoryCode === "RENTER_BEHAVIOUR") {
    const maintenanceMax = activeRules
      .filter((rule) => PROPERTY_MAINTENANCE_RATING_CODES.includes(rule.code as (typeof PROPERTY_MAINTENANCE_RATING_CODES)[number]))
      .reduce((max, rule) => Math.max(max, rule.points), 0);
    const complianceMax = activeRules
      .filter((rule) => LEASE_COMPLIANCE_RATING_CODES.includes(rule.code as (typeof LEASE_COMPLIANCE_RATING_CODES)[number]))
      .reduce((max, rule) => Math.max(max, rule.points), 0);
    return Math.max(maintenanceMax, 0) + Math.max(complianceMax, 0);
  }

  return activeRules.reduce((max, rule) => Math.max(max, rule.points), 0);
}

function buildCategoryBreakdown(
  categories: Array<{ code: string; name: string; maxScore: number; isActive: boolean; sortOrder: number }>,
  breakdown: Array<{
    categoryCode: CategoryCode;
    contribution: number;
  }>,
  overridesByCategoryCode: Map<string, { id: string; note?: string | null }>
) {
  return categories
    .filter((category) => category.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => {
    const score = clampCategoryScore(
      breakdown
        .filter((item) => item.categoryCode === category.code)
        .reduce((sum, item) => sum + item.contribution, 0),
      category.maxScore
    );
    const override = overridesByCategoryCode.get(category.code) || null;

    return {
      code: category.code,
      name: category.name,
      score,
      maxScore: category.maxScore,
      overridden: Boolean(override),
      overrideId: override?.id || null,
      overrideNote: override?.note || null
    };
  });
}

async function fetchPolicyWithRules(tx: DbClient) {
  return tx.rentScorePolicy.findUnique({
    where: { code: DEFAULT_POLICY_CODE },
    include: {
      categories: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      },
      rules: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      }
    }
  });
}

export async function ensureDefaultRentScorePolicy(tx: DbClient = prisma) {
  const policy = await tx.rentScorePolicy.upsert({
    where: { code: DEFAULT_POLICY_CODE },
    update: {
      name: "Rent score default policy",
      description: "Default RentSure rent score policy for renters.",
      minScore: 0,
      maxScore: 1000,
      isActive: true
    },
    create: {
      code: DEFAULT_POLICY_CODE,
      name: "Rent score default policy",
      description: "Default RentSure rent score policy for renters.",
      minScore: 0,
      maxScore: 1000,
      isActive: true
    }
  });

  await Promise.all(
    DEFAULT_CATEGORY_DEFINITIONS.map((category) =>
      tx.rentScoreCategoryConfig.upsert({
        where: {
          policyId_code: {
            policyId: policy.id,
            code: category.code
          }
        },
        update: {
          name: category.name,
          maxScore: category.maxScore,
          sortOrder: category.sortOrder,
          isActive: true
        },
        create: {
          policyId: policy.id,
          code: category.code,
          name: category.name,
          maxScore: category.maxScore,
          sortOrder: category.sortOrder,
          isActive: true
        }
      })
    )
  );

  await Promise.all(
    defaultRuleDefinitions.map((rule) =>
      tx.rentScoreRule.upsert({
        where: {
          policyId_code: {
            policyId: policy.id,
            code: rule.code
          }
        },
        update: {
          name: rule.name,
          description: rule.description,
          points: rule.points,
          maxOccurrences: rule.maxOccurrences ?? null,
          sortOrder: rule.sortOrder,
          metadata: rule.metadata,
          isActive: true
        },
        create: {
          policyId: policy.id,
          code: rule.code,
          name: rule.name,
          description: rule.description,
          points: rule.points,
          maxOccurrences: rule.maxOccurrences ?? null,
          sortOrder: rule.sortOrder,
          metadata: rule.metadata,
          isActive: true
        }
      })
    )
  );

  if (LEGACY_RULE_CODES.length > 0) {
    await tx.rentScoreRule.updateMany({
      where: {
        policyId: policy.id,
        code: {
          in: [...LEGACY_RULE_CODES]
        }
      },
      data: {
        isActive: false
      }
    });
  }

  return fetchPolicyWithRules(tx);
}

async function resolvePolicy(tx: DbClient = prisma) {
  const ensured = await ensureDefaultRentScorePolicy(tx);
  if (!ensured) {
    throw new AppError("Rent score policy could not be initialized", 500, "RENT_SCORE_POLICY_ERROR");
  }
  return ensured;
}

async function resolveRenterAccount(publicAccountId: string, tx: DbClient = prisma) {
  const account = await tx.publicAccount.findUnique({
    where: { id: publicAccountId }
  });

  if (!account) {
    throw new AppError("Renter account not found", 404, "RENTER_NOT_FOUND");
  }

  if (account.accountType !== "RENTER") {
    throw new AppError("Rent score is only available for renter accounts", 400, "INVALID_RENT_SCORE_ACCOUNT");
  }

  return account;
}

export async function buildRentScoreSnapshot(publicAccountId: string, tx: DbClient = prisma) {
  const policy = await resolvePolicy(tx);
  const ruleMap = configuredRuleMap(
    (policy.rules || []).map((rule: any) => ({
      code: rule.code,
      points: rule.points,
      isActive: rule.isActive,
      name: rule.name,
      description: rule.description || ""
    }))
  );
  const categoryConfigs: Array<{
    code: string;
    name: string;
    maxScore: number;
    isActive: boolean;
    sortOrder: number;
  }> = (policy.categories || []).map((category: any) => ({
    code: category.code,
    name: category.name,
    maxScore: category.maxScore,
    isActive: category.isActive,
    sortOrder: category.sortOrder
  }));
  const activeCategoryCodes = new Set(
    categoryConfigs.filter((category) => category.isActive).map((category) => category.code)
  );
  const account = await resolveRenterAccount(publicAccountId, tx);
  const [events, linkedCases, overrides] = await Promise.all([
    tx.rentScoreEvent.findMany({
      where: { publicAccountId },
      include: {
        rule: true,
        recordedBy: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }]
    }),
    tx.proposedRenter.findMany({
      where: {
        renterAccountId: publicAccountId,
        decision: "APPROVED"
      },
      include: {
        propertyUnit: true,
        paymentSchedules: {
          orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }]
        }
      },
      orderBy: { updatedAt: "desc" }
    }),
    tx.rentScoreOverride.findMany({
      where: {
        publicAccountId,
        isActive: true
      },
      include: {
        createdBy: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      },
      orderBy: [{ createdAt: "desc" }]
    })
  ]);

  const allSchedules = linkedCases.flatMap((item: any) => item.paymentSchedules);
  const rentSchedules = allSchedules.filter((schedule: any) => schedule.paymentType === "RENT");
  const utilitySchedules = allSchedules.filter((schedule: any) => schedule.paymentType === "UTILITY");
  const now = new Date();
  const accountCreatedRule = ruleMap.get(REGISTRATION_RULE_CODE) ?? null;
  const emailVerifiedRule = ruleMap.get("EMAIL_VERIFIED") ?? null;
  const phoneUpdatedRule = ruleMap.get(PHONE_UPDATED_RULE_CODE) ?? null;
  const governmentIdRule = ruleMap.get(GOVERNMENT_ID_RULE_CODE) ?? null;
  const completeProfileRule = ruleMap.get(PROFILE_COMPLETED_RULE_CODE) ?? null;
  const hasPhone = hasValue(account.phone);
  const profileComplete = isProfileComplete(account);
  const identityApproved = account.identityReviewStatus === "APPROVED";

  const identityBreakdown = [
    {
      ruleId: "category:identity:account-created",
      code: REGISTRATION_RULE_CODE,
      name: accountCreatedRule?.name ?? "Account created",
      description: accountCreatedRule?.description || "Renter account has been created on RentSure.",
      points: accountCreatedRule?.points ?? 0,
      maxOccurrences: 1,
      isActive: accountCreatedRule?.isActive ?? true,
      quantity: account.emailVerifiedAt ? 1 : 0,
      appliedOccurrences: account.emailVerifiedAt ? 1 : 0,
      contribution: configuredContribution(accountCreatedRule, Boolean(account.emailVerifiedAt)),
      lastOccurredAt: account.emailVerifiedAt ?? null
    },
    {
      ruleId: "category:identity:email-verified",
      code: "EMAIL_VERIFIED",
      name: emailVerifiedRule?.name ?? "Email verified",
      description: emailVerifiedRule?.description || "Renter has verified the account email address.",
      points: emailVerifiedRule?.points ?? 0,
      maxOccurrences: 1,
      isActive: emailVerifiedRule?.isActive ?? true,
      quantity: account.emailVerifiedAt ? 1 : 0,
      appliedOccurrences: account.emailVerifiedAt ? 1 : 0,
      contribution: configuredContribution(emailVerifiedRule, Boolean(account.emailVerifiedAt)),
      lastOccurredAt: account.emailVerifiedAt ?? null
    },
    {
      ruleId: "category:identity:phone-updated",
      code: PHONE_UPDATED_RULE_CODE,
      name: phoneUpdatedRule?.name ?? "Phone updated",
      description: phoneUpdatedRule?.description || "Renter has provided a phone number on the profile.",
      points: phoneUpdatedRule?.points ?? 0,
      maxOccurrences: 1,
      isActive: phoneUpdatedRule?.isActive ?? true,
      quantity: hasPhone ? 1 : 0,
      appliedOccurrences: hasPhone ? 1 : 0,
      contribution: configuredContribution(phoneUpdatedRule, hasPhone),
      lastOccurredAt: hasPhone ? account.updatedAt : null
    },
    {
      ruleId: "category:identity:government-id",
      code: GOVERNMENT_ID_RULE_CODE,
      name: governmentIdRule?.name ?? "Government ID verified",
      description: governmentIdRule?.description || "Renter identity has been reviewed and approved by RentSure.",
      points: governmentIdRule?.points ?? 0,
      maxOccurrences: 1,
      isActive: governmentIdRule?.isActive ?? true,
      quantity: identityApproved ? 1 : 0,
      appliedOccurrences: identityApproved ? 1 : 0,
      contribution: configuredContribution(governmentIdRule, identityApproved),
      lastOccurredAt: account.identityReviewedAt ?? null
    },
    {
      ruleId: "category:identity:complete-profile",
      code: PROFILE_COMPLETED_RULE_CODE,
      name: completeProfileRule?.name ?? "Complete profile",
      description: completeProfileRule?.description || "Renter profile has complete core identity and address details.",
      points: completeProfileRule?.points ?? 0,
      maxOccurrences: 1,
      isActive: completeProfileRule?.isActive ?? true,
      quantity: profileComplete ? 1 : 0,
      appliedOccurrences: profileComplete ? 1 : 0,
      contribution: configuredContribution(completeProfileRule, profileComplete),
      lastOccurredAt: profileComplete ? account.updatedAt : null
    }
  ];

  const latestRentSchedule = latestRelevantSchedule(rentSchedules, now);
  const latestUtilitySchedule = latestRelevantSchedule(utilitySchedules, now);
  const rentPaymentRuleCode = paymentRuleCodeFromLatestSchedule(latestRentSchedule, {
    onTimeRuleCode: "RENT_PAID_ON_OR_BEFORE_DUE_DATE",
    withinGraceRuleCode: "RENT_PAID_WITHIN_GRACE_PERIOD",
    missedRuleCode: RENT_MISSED_RULE_CODE,
    gracePeriodDays: 60
  });
  const utilityPaymentRuleCode = paymentRuleCodeFromLatestSchedule(latestUtilitySchedule, {
    onTimeRuleCode: "UTILITY_PAID_ON_TIME",
    withinGraceRuleCode: "UTILITY_PAID_WITHIN_GRACE_PERIOD",
    missedRuleCode: UTILITY_MISSED_RULE_CODE,
    gracePeriodDays: 60
  });
  const rentPaymentRule = rentPaymentRuleCode ? ruleMap.get(rentPaymentRuleCode) ?? null : null;
  const utilityPaymentRule = utilityPaymentRuleCode ? ruleMap.get(utilityPaymentRuleCode) ?? null : null;
  const rentPaymentScore = rentPaymentRule?.isActive ? rentPaymentRule.points : 0;
  const utilityPaymentScore = utilityPaymentRule?.isActive ? utilityPaymentRule.points : 0;

  const paymentBreakdown = [
    {
      ruleId: "category:payment:rent",
      code: rentPaymentRule?.code ?? "RENT_PAYMENT_HISTORY",
      name: rentPaymentRule?.name ?? "Payment of rent",
      description: rentPaymentRule?.description || "Latest rent payment status based on due date and grace period.",
      points: rentPaymentRule?.points ?? 0,
      maxOccurrences: 1,
      isActive: rentPaymentRule?.isActive ?? true,
      quantity: latestRentSchedule ? 1 : 0,
      appliedOccurrences: latestRentSchedule ? 1 : 0,
      contribution: rentPaymentScore,
      lastOccurredAt: latestRentSchedule?.dueDate ?? null
    },
    {
      ruleId: "category:payment:utility",
      code: utilityPaymentRule?.code ?? "UTILITY_PAYMENT_HISTORY",
      name: utilityPaymentRule?.name ?? "Utility payment",
      description: utilityPaymentRule?.description || "Latest utility payment status based on due date and grace period.",
      points: utilityPaymentRule?.points ?? 0,
      maxOccurrences: 1,
      isActive: utilityPaymentRule?.isActive ?? true,
      quantity: latestUtilitySchedule ? 1 : 0,
      appliedOccurrences: latestUtilitySchedule ? 1 : 0,
      contribution: utilityPaymentScore,
      lastOccurredAt: latestUtilitySchedule?.dueDate ?? null
    }
  ];

  const latestPropertyMaintenanceEvent = getLatestEventByCodes(events, PROPERTY_MAINTENANCE_RATING_CODES);
  const latestLeaseComplianceEvent = getLatestEventByCodes(events, LEASE_COMPLIANCE_RATING_CODES);

  const behaviourBreakdown = [
    {
      ruleId: "category:behaviour:property-maintenance",
      code: latestPropertyMaintenanceEvent?.rule.code ?? "PROPERTY_MAINTENANCE_UNSET",
      name: latestPropertyMaintenanceEvent?.rule.name ?? "Property maintenance",
      description: latestPropertyMaintenanceEvent?.rule.description || "Latest landlord property maintenance rating.",
      points: latestPropertyMaintenanceEvent?.rule.points ?? 0,
      maxOccurrences: 1,
      isActive: latestPropertyMaintenanceEvent?.rule.isActive ?? true,
      quantity: latestPropertyMaintenanceEvent ? 1 : 0,
      appliedOccurrences: latestPropertyMaintenanceEvent ? 1 : 0,
      contribution: latestPropertyMaintenanceEvent?.rule.points ?? 0,
      lastOccurredAt: latestPropertyMaintenanceEvent?.occurredAt ?? null
    },
    {
      ruleId: "category:behaviour:lease-compliance",
      code: latestLeaseComplianceEvent?.rule.code ?? "LEASE_COMPLIANCE_UNSET",
      name: latestLeaseComplianceEvent?.rule.name ?? "General lease compliance",
      description: latestLeaseComplianceEvent?.rule.description || "Latest landlord lease compliance rating.",
      points: latestLeaseComplianceEvent?.rule.points ?? 0,
      maxOccurrences: 1,
      isActive: latestLeaseComplianceEvent?.rule.isActive ?? true,
      quantity: latestLeaseComplianceEvent ? 1 : 0,
      appliedOccurrences: latestLeaseComplianceEvent ? 1 : 0,
      contribution: latestLeaseComplianceEvent?.rule.points ?? 0,
      lastOccurredAt: latestLeaseComplianceEvent?.occurredAt ?? null
    }
  ];

  const rentalStabilityRuleCode =
    account.residenceMoveCount5y == null
      ? null
      : account.residenceMoveCount5y <= 1
        ? "RENTAL_STABILITY_1_MOVE"
        : account.residenceMoveCount5y === 2
          ? "RENTAL_STABILITY_2_MOVES"
          : "RENTAL_STABILITY_3_PLUS_MOVES";
  const rentalStabilityRule = rentalStabilityRuleCode ? ruleMap.get(rentalStabilityRuleCode) ?? null : null;

  const employmentStabilityRuleCode =
    account.employmentType == null || account.employmentYears == null
      ? null
      : account.employmentType === "EMPLOYED"
        ? account.employmentYears <= 1
          ? "EMPLOYED_1_YEAR"
          : account.employmentYears === 2
            ? "EMPLOYED_2_YEARS"
            : "EMPLOYED_3_PLUS_YEARS"
        : account.employmentYears >= 5
          ? "SELF_EMPLOYED_5_PLUS_YEARS"
          : account.employmentYears >= 3
            ? "SELF_EMPLOYED_3_TO_4_YEARS"
            : "SELF_EMPLOYED_UNDER_3_YEARS";
  const employmentStabilityRule = employmentStabilityRuleCode ? ruleMap.get(employmentStabilityRuleCode) ?? null : null;

  const latestLandlordReferenceEvent = getLatestEventByCodes(events, LANDLORD_REFERENCE_CODES);
  const landlordReferenceScore = latestLandlordReferenceEvent ? latestLandlordReferenceEvent.rule.points : 0;

  const latestLinkedUnitWithRent = linkedCases.find((item: any) => item.propertyUnit?.annualRentAmountNgn != null)?.propertyUnit ?? null;
  const annualRentAmountNgn = latestLinkedUnitWithRent?.annualRentAmountNgn ?? null;
  const renterBandRuleCode =
    annualRentAmountNgn == null
      ? null
      : annualRentAmountNgn < 500_000
        ? "RENTER_BAND_D"
        : annualRentAmountNgn <= 1_000_000
          ? "RENTER_BAND_C"
          : annualRentAmountNgn <= 2_500_000
            ? "RENTER_BAND_B"
            : "RENTER_BAND_A";
  const renterBandRule = renterBandRuleCode ? ruleMap.get(renterBandRuleCode) ?? null : null;
  const renterBandScore = configuredContribution(renterBandRule, annualRentAmountNgn != null);

  const baseBreakdown = [
    ...identityBreakdown.map((item) => ({ ...item, categoryCode: "IDENTITY_VERIFICATION" as const })),
    ...paymentBreakdown.map((item) => ({ ...item, categoryCode: "PAYMENT" as const })),
    ...behaviourBreakdown.map((item) => ({ ...item, categoryCode: "RENTER_BEHAVIOUR" as const })),
    {
      ruleId: "category:rental-stability",
      code: rentalStabilityRule?.code ?? "RENTAL_STABILITY",
      categoryCode: "RENTAL_STABILITY" as const,
      name: rentalStabilityRule?.name ?? "Rental stability",
      description: rentalStabilityRule?.description || "Number of moves supplied for the last five years.",
      points: rentalStabilityRule?.points ?? 0,
      maxOccurrences: 1,
      isActive: rentalStabilityRule?.isActive ?? true,
      quantity: account.residenceMoveCount5y ?? 0,
      appliedOccurrences: account.residenceMoveCount5y == null ? 0 : 1,
      contribution: configuredContribution(rentalStabilityRule, account.residenceMoveCount5y != null),
      lastOccurredAt: account.residenceMoveCount5y == null ? null : account.updatedAt
    },
    {
      ruleId: "category:employment-stability",
      code: employmentStabilityRule?.code ?? "EMPLOYMENT_STABILITY",
      categoryCode: "EMPLOYMENT_STABILITY" as const,
      name: employmentStabilityRule?.name ?? "Employment / business stability",
      description: employmentStabilityRule?.description || "Employment type and years supplied on the renter profile.",
      points: employmentStabilityRule?.points ?? 0,
      maxOccurrences: 1,
      isActive: employmentStabilityRule?.isActive ?? true,
      quantity: account.employmentYears ?? 0,
      appliedOccurrences: account.employmentType == null || account.employmentYears == null ? 0 : 1,
      contribution: configuredContribution(
        employmentStabilityRule,
        account.employmentType != null && account.employmentYears != null
      ),
      lastOccurredAt: account.employmentType == null || account.employmentYears == null ? null : account.updatedAt
    },
    {
      ruleId: "category:landlord-reference",
      code: latestLandlordReferenceEvent?.rule.code ?? "LANDLORD_REFERENCE_UNSET",
      categoryCode: "LANDLORD_REFERENCE" as const,
      name: latestLandlordReferenceEvent?.rule.name ?? "Landlord reference",
      description: latestLandlordReferenceEvent?.rule.description || "Latest verified current or previous landlord reference.",
      points: latestLandlordReferenceEvent?.rule.points ?? 0,
      maxOccurrences: 1,
      isActive: latestLandlordReferenceEvent?.rule.isActive ?? true,
      quantity: latestLandlordReferenceEvent ? 1 : 0,
      appliedOccurrences: latestLandlordReferenceEvent ? 1 : 0,
      contribution: landlordReferenceScore,
      lastOccurredAt: latestLandlordReferenceEvent?.occurredAt ?? null
    },
    {
      ruleId: "category:renter-band",
      code: renterBandRule?.code ?? "RENTER_BAND",
      categoryCode: "RENTER_BAND" as const,
      name: renterBandRule?.name ?? "Renter band",
      description: renterBandRule?.description || "Band derived from the annual rent amount of the linked property unit.",
      points: renterBandRule?.points ?? 0,
      maxOccurrences: 1,
      isActive: renterBandRule?.isActive ?? true,
      quantity: annualRentAmountNgn == null ? 0 : annualRentAmountNgn,
      appliedOccurrences: annualRentAmountNgn == null ? 0 : 1,
      contribution: renterBandScore,
      lastOccurredAt: annualRentAmountNgn == null ? null : linkedCases[0]?.updatedAt ?? account.updatedAt
    }
  ];

  const itemOverridesByCode = new Map<string, { id: string; note?: string | null }>(
    overrides
      .filter((override: any) => override.scope === "BREAKDOWN_ITEM")
      .map((override: any) => [override.targetCode, { id: override.id, note: override.note }] as const)
  );
  const categoryOverridesByCode = new Map<string, { id: string; note?: string | null }>(
    overrides
      .filter((override: any) => override.scope === "CATEGORY")
      .map((override: any) => [override.targetCode, { id: override.id, note: override.note }] as const)
  );

  const breakdown = baseBreakdown.map((item: any) => {
    const categoryOverride = categoryOverridesByCode.get(item.categoryCode) || null;
    const itemOverride = itemOverridesByCode.get(item.code) || null;
    const activeOverride = categoryOverride || itemOverride;
    const categoryEnabled = activeCategoryCodes.has(item.categoryCode);

    return {
      ...item,
      contribution: !categoryEnabled || activeOverride ? 0 : item.contribution,
      overridden: Boolean(activeOverride),
      overrideScope: categoryOverride ? "CATEGORY" : itemOverride ? "BREAKDOWN_ITEM" : null,
      overrideId: activeOverride?.id || null,
      overrideNote: activeOverride?.note || null
    };
  });

  const categoryBreakdown = buildCategoryBreakdown(categoryConfigs, breakdown, categoryOverridesByCode);

  const configuredMaxScore = categoryBreakdown.reduce((total: number, item: any) => total + item.maxScore, 0);
  const rawScore = categoryBreakdown.reduce((total: number, item: any) => total + item.score, 0);
  const score = clampScore(rawScore, policy.minScore, configuredMaxScore || policy.maxScore);
  const positivePoints = breakdown
    .filter((item: any) => item.contribution > 0)
    .reduce((sum: number, item: any) => sum + item.contribution, 0);
  const negativePoints = Math.abs(
    breakdown.filter((item: any) => item.contribution < 0).reduce((sum: number, item: any) => sum + item.contribution, 0)
  );

  return {
    account: {
      id: account.id,
      accountType: account.accountType,
      entityType: account.entityType,
      firstName: account.firstName,
      lastName: account.lastName,
      organizationName: account.organizationName,
      email: account.email,
      phone: account.phone,
      state: account.state,
      city: account.city,
      address: account.address,
      status: account.status,
      createdAt: account.createdAt
    },
    policy: {
      id: policy.id,
      code: policy.code,
      name: policy.name,
      description: policy.description,
      minScore: policy.minScore,
      maxScore: policy.maxScore,
      isActive: policy.isActive,
      updatedAt: policy.updatedAt
    },
    summary: {
      score,
      rawScore,
      minScore: policy.minScore,
      maxScore: configuredMaxScore || policy.maxScore,
      positivePoints,
      negativePoints,
      eventCount: events.length,
      scoreBand: scoreBand(score)
    },
    activeOverrides: overrides.map((override: any) => ({
      id: override.id,
      scope: override.scope,
      targetCode: override.targetCode,
      note: override.note,
      createdAt: override.createdAt,
      createdBy: override.createdBy
        ? {
            id: override.createdBy.id,
            fullName: override.createdBy.fullName,
            email: override.createdBy.email
          }
        : null
    })),
    categoryBreakdown,
    breakdown,
    recentEvents: events.slice(0, 20).map((event: any) => ({
      id: event.id,
      quantity: event.quantity,
      occurredAt: event.occurredAt,
      sourceNote: event.sourceNote,
      metadata: event.metadata,
      rule: {
        id: event.rule.id,
        code: event.rule.code,
        name: event.rule.name,
        points: event.rule.points
      },
      recordedBy: event.recordedBy
    }))
  };
}

export async function getRentScoreConfig(tx: DbClient = prisma) {
  const policy = await resolvePolicy(tx);
  const visibleRules = policy.rules.filter((rule: any) => DEFAULT_RULE_CODES.has(rule.code));
  return {
    id: policy.id,
    code: policy.code,
    name: policy.name,
    description: policy.description,
    minScore: policy.minScore,
    maxScore: policy.maxScore,
    isActive: policy.isActive,
    updatedAt: policy.updatedAt,
    categories: (policy.categories || [])
      .sort((left: any, right: any) => left.sortOrder - right.sortOrder)
      .map((category: any) => ({
        id: category.id,
        code: category.code,
        name: category.name,
        maxScore: category.maxScore,
        isActive: category.isActive,
        sortOrder: category.sortOrder,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt
      })),
    rules: visibleRules.map((rule: any) => ({
      id: rule.id,
      code: rule.code,
      categoryCode: inferRuleCategoryCode(rule.code) ?? "IDENTITY_VERIFICATION",
      name: rule.name,
      description: rule.description,
      points: rule.points,
      maxOccurrences: rule.maxOccurrences,
      isActive: rule.isActive,
      sortOrder: rule.sortOrder,
      metadata: rule.metadata,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt
    }))
  };
}

export async function updateRentScoreCategory(
  categoryId: string,
  input: {
    name?: string;
    maxScore?: number;
  }
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.rentScoreCategoryConfig.findUnique({ where: { id: categoryId } });
    if (!existing) {
      throw new AppError("Rent score category not found", 404, "RENT_SCORE_CATEGORY_NOT_FOUND");
    }

    if (input.maxScore !== undefined) {
      const categoryCode = existing.code as CategoryCode;
      const categoryRules = await tx.rentScoreRule.findMany({
        where: {
          policyId: existing.policyId,
          isActive: true,
          code: {
            in: Array.from(DEFAULT_RULE_CODES)
          }
        }
      });
      const configuredPoints = calculateConfiguredCategoryPoints(
        categoryCode,
        categoryRules
          .filter((rule: any) => inferRuleCategoryCode(rule.code) === categoryCode)
          .map((rule: any) => ({
            code: rule.code,
            points: rule.points,
            isActive: rule.isActive
          }))
      );

      if (configuredPoints > input.maxScore) {
        throw new AppError(
          `${existing.name} currently totals ${configuredPoints} points. Increase the category max score or reduce the point rows before saving.`,
          400,
          "RENT_SCORE_CATEGORY_MAX_EXCEEDED"
        );
      }
    }

    await tx.rentScoreCategoryConfig.update({
      where: { id: categoryId },
      data: {
        name: input.name?.trim() || undefined,
        maxScore: input.maxScore
      }
    });

    return getRentScoreConfig(tx);
  });
}

export async function deleteRentScoreCategory(categoryId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.rentScoreCategoryConfig.findUnique({ where: { id: categoryId } });
    if (!existing) {
      throw new AppError("Rent score category not found", 404, "RENT_SCORE_CATEGORY_NOT_FOUND");
    }

    await tx.rentScoreCategoryConfig.update({
      where: { id: categoryId },
      data: {
        isActive: false
      }
    });

    return getRentScoreConfig(tx);
  });
}

export async function listRentScoreRules() {
  const config = await getRentScoreConfig();
  return {
    items: config.rules
  };
}

export async function createRentScoreOverride(input: {
  publicAccountId: string;
  scope: RentScoreOverrideScope;
  targetCode: string;
  note?: string;
  createdByUserId?: string | null;
}) {
  const targetCode = input.targetCode.trim().toUpperCase();
  const snapshot = await buildRentScoreSnapshot(input.publicAccountId);

  if (input.scope === "CATEGORY") {
    if (!isCategoryCode(targetCode)) {
      throw new AppError("Unknown rent score category", 400, "VALIDATION_ERROR");
    }
  } else {
    const validTarget = snapshot.breakdown.some((item: any) => item.code === targetCode);
    if (!validTarget) {
      throw new AppError("Unknown rent score item", 400, "VALIDATION_ERROR");
    }
  }

  return prisma.$transaction(async (tx) => {
    await resolveRenterAccount(input.publicAccountId, tx);

    const existingActive = await tx.rentScoreOverride.findFirst({
      where: {
        publicAccountId: input.publicAccountId,
        scope: input.scope,
        targetCode,
        isActive: true
      }
    });

    if (!existingActive) {
      await tx.rentScoreOverride.create({
        data: {
          publicAccountId: input.publicAccountId,
          scope: input.scope,
          targetCode,
          note: input.note?.trim() || null,
          createdByUserId: input.createdByUserId ?? null
        }
      });
    }

    return buildRentScoreSnapshot(input.publicAccountId, tx);
  });
}

export async function deleteRentScoreOverride(overrideId: string) {
  return prisma.$transaction(async (tx) => {
    const override = await tx.rentScoreOverride.findUnique({ where: { id: overrideId } });
    if (!override || !override.isActive) {
      throw new AppError("Rent score override not found", 404, "RENT_SCORE_OVERRIDE_NOT_FOUND");
    }

    await tx.rentScoreOverride.update({
      where: { id: overrideId },
      data: {
        isActive: false
      }
    });

    return buildRentScoreSnapshot(override.publicAccountId, tx);
  });
}

export async function updateRentScorePolicy(input: {
  name?: string;
  description?: string | null;
  minScore?: number;
  maxScore?: number;
  isActive?: boolean;
}) {
  const current = await resolvePolicy();
  const nextMinScore = input.minScore ?? current.minScore;
  const nextMaxScore = input.maxScore ?? current.maxScore;

  if (nextMinScore < 0 || nextMaxScore > 900 || nextMinScore >= nextMaxScore) {
    throw new AppError("Rent score bounds must stay between 0 and 900, with min below max", 400, "VALIDATION_ERROR");
  }

  await prisma.rentScorePolicy.update({
    where: { id: current.id },
    data: {
      name: input.name ?? current.name,
      description: input.description === undefined ? current.description : input.description,
      minScore: nextMinScore,
      maxScore: nextMaxScore,
      isActive: input.isActive ?? current.isActive
    }
  });

  return getRentScoreConfig();
}

export async function createRentScoreRule(input: {
  code: string;
  name: string;
  description?: string | null;
  points: number;
  maxOccurrences?: number | null;
  isActive?: boolean;
  sortOrder?: number;
  metadata?: Prisma.JsonObject;
}) {
  const policy = await resolvePolicy();
  const code = normalizeRuleCode(input.code);

  if (!code) {
    throw new AppError("Rule code is required", 400, "VALIDATION_ERROR");
  }

  await prisma.rentScoreRule.create({
    data: {
      policyId: policy.id,
      code,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      points: input.points,
      maxOccurrences: input.maxOccurrences ?? null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? policy.rules.length * 10 + 10,
      metadata: input.metadata
    }
  });

  return getRentScoreConfig();
}

export async function updateRentScoreRule(
  ruleId: string,
  input: {
    name?: string;
    description?: string | null;
    points?: number;
    maxOccurrences?: number | null;
    isActive?: boolean;
    sortOrder?: number;
    metadata?: Prisma.JsonObject;
  }
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.rentScoreRule.findUnique({ where: { id: ruleId } });
    if (!existing) {
      throw new AppError("Rent score rule not found", 404, "RENT_SCORE_RULE_NOT_FOUND");
    }

    const categoryCode = inferRuleCategoryCode(existing.code);
    if (!categoryCode) {
      throw new AppError("This point row is not mapped to an editable rent score category", 400, "VALIDATION_ERROR");
    }

    const category = await tx.rentScoreCategoryConfig.findFirst({
      where: {
        policyId: existing.policyId,
        code: categoryCode,
        isActive: true
      }
    });

    if (!category) {
      throw new AppError("Rent score category not found for this point row", 404, "RENT_SCORE_CATEGORY_NOT_FOUND");
    }

    const categoryRules = await tx.rentScoreRule.findMany({
      where: {
        policyId: existing.policyId,
        isActive: true,
        code: {
          in: Array.from(DEFAULT_RULE_CODES)
        }
      }
    });

    const configuredPoints = calculateConfiguredCategoryPoints(
      categoryCode,
      categoryRules
        .filter((rule: any) => inferRuleCategoryCode(rule.code) === categoryCode)
        .map((rule: any) => ({
          code: rule.code,
          points: rule.id === ruleId && input.points !== undefined ? input.points : rule.points,
          isActive: rule.isActive
        }))
    );

    if (configuredPoints > category.maxScore) {
      throw new AppError(
        `${category.name} allows at most ${category.maxScore} points, but this change would make it ${configuredPoints}. Reduce the point value or increase the category max score.`,
        400,
        "RENT_SCORE_CATEGORY_MAX_EXCEEDED"
      );
    }

    await tx.rentScoreRule.update({
      where: { id: ruleId },
      data: {
        name: input.name?.trim(),
        description: input.description === undefined ? undefined : input.description?.trim() || null,
        points: input.points,
        maxOccurrences: input.maxOccurrences === undefined ? undefined : input.maxOccurrences,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
        metadata: input.metadata
      }
    });

    return getRentScoreConfig(tx);
  });
}

export async function deleteRentScoreRule(ruleId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.rentScoreRule.findUnique({ where: { id: ruleId } });
    if (!existing) {
      throw new AppError("Rent score rule not found", 404, "RENT_SCORE_RULE_NOT_FOUND");
    }

    await tx.rentScoreRule.update({
      where: { id: ruleId },
      data: {
        isActive: false
      }
    });

    return getRentScoreConfig(tx);
  });
}

async function resolveRuleForEvent(input: { ruleId?: string; ruleCode?: string }, tx: DbClient = prisma) {
  const policy = await resolvePolicy(tx);

  if (input.ruleId) {
    const rule = await tx.rentScoreRule.findUnique({ where: { id: input.ruleId } });
    if (!rule || rule.policyId !== policy.id) {
      throw new AppError("Rent score rule not found", 404, "RENT_SCORE_RULE_NOT_FOUND");
    }
    return rule;
  }

  if (input.ruleCode) {
    const code = normalizeRuleCode(input.ruleCode);
    const rule = await tx.rentScoreRule.findUnique({
      where: {
        policyId_code: {
          policyId: policy.id,
          code
        }
      }
    });
    if (!rule) {
      throw new AppError("Rent score rule not found", 404, "RENT_SCORE_RULE_NOT_FOUND");
    }
    return rule;
  }

  throw new AppError("A rule identifier is required", 400, "VALIDATION_ERROR");
}

export async function recordRentScoreEvent(input: {
  publicAccountId: string;
  ruleId?: string;
  ruleCode?: string;
  quantity?: number;
  occurredAt?: Date;
  recordedByUserId?: string | null;
  sourceNote?: string;
  metadata?: Prisma.JsonObject;
}) {
  return prisma.$transaction(async (tx) => {
    await resolveRenterAccount(input.publicAccountId, tx);
    const rule = await resolveRuleForEvent({ ruleId: input.ruleId, ruleCode: input.ruleCode }, tx);

    await tx.rentScoreEvent.create({
      data: {
        publicAccountId: input.publicAccountId,
        ruleId: rule.id,
        quantity: input.quantity ?? 1,
        occurredAt: input.occurredAt ?? new Date(),
        recordedByUserId: input.recordedByUserId ?? null,
        sourceNote: input.sourceNote?.trim() || null,
        metadata: input.metadata
      }
    });

    return buildRentScoreSnapshot(input.publicAccountId, tx);
  });
}

export async function replaceRentScoreEventsByCodes(input: {
  publicAccountId: string;
  codes: string[];
  tx?: DbClient;
  newEvent?:
    | {
        ruleCode: string;
        quantity?: number;
        occurredAt?: Date;
        recordedByUserId?: string | null;
        sourceNote?: string;
        metadata?: Prisma.JsonObject;
      }
    | null;
}) {
  const run = async (tx: DbClient) => {
    await resolveRenterAccount(input.publicAccountId, tx);
    const policy = await resolvePolicy(tx);
    const normalizedCodes = input.codes.map(normalizeRuleCode);
    const rules = await tx.rentScoreRule.findMany({
      where: {
        policyId: policy.id,
        code: { in: normalizedCodes }
      },
      select: { id: true, code: true }
    });

    if (rules.length) {
      await tx.rentScoreEvent.deleteMany({
        where: {
          publicAccountId: input.publicAccountId,
          ruleId: { in: rules.map((rule: { id: string }) => rule.id) }
        }
      });
    }

    if (input.newEvent) {
      const rule = await resolveRuleForEvent({ ruleCode: input.newEvent.ruleCode }, tx);
      await tx.rentScoreEvent.create({
        data: {
          publicAccountId: input.publicAccountId,
          ruleId: rule.id,
          quantity: input.newEvent.quantity ?? 1,
          occurredAt: input.newEvent.occurredAt ?? new Date(),
          recordedByUserId: input.newEvent.recordedByUserId ?? null,
          sourceNote: input.newEvent.sourceNote?.trim() || null,
          metadata: input.newEvent.metadata
        }
      });
    }

    return buildRentScoreSnapshot(input.publicAccountId, tx);
  };

  if (input.tx) {
    return run(input.tx);
  }

  return prisma.$transaction(run);
}

export async function deleteRentScoreEvent(eventId: string) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.rentScoreEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new AppError("Rent score event not found", 404, "RENT_SCORE_EVENT_NOT_FOUND");
    }

    await tx.rentScoreEvent.delete({ where: { id: eventId } });
    return buildRentScoreSnapshot(event.publicAccountId, tx);
  });
}

export async function ensureRegistrationRentScoreEvent(publicAccountId: string) {
  return ensureSingleRentScoreEvent(publicAccountId, REGISTRATION_RULE_CODE, "Automatic registration bonus");
}

export async function ensureSingleRentScoreEvent(publicAccountId: string, ruleCode: string, sourceNote?: string) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.publicAccount.findUnique({ where: { id: publicAccountId } });
    if (!account || account.accountType !== "RENTER") {
      return null;
    }

    const rule = await resolveRuleForEvent({ ruleCode }, tx);
    const existingEvent = await tx.rentScoreEvent.findFirst({
      where: {
        publicAccountId,
        ruleId: rule.id
      }
    });

    if (!existingEvent) {
      await tx.rentScoreEvent.create({
        data: {
          publicAccountId,
          ruleId: rule.id,
          quantity: 1,
          occurredAt: new Date(),
          sourceNote: sourceNote?.trim() || null
        }
      });
    }

    return buildRentScoreSnapshot(publicAccountId, tx);
  });
}

export async function syncUtilityPaymentHistoryEvent(publicAccountId: string, tx: DbClient = prisma) {
  const now = new Date();
  const schedules = await tx.paymentSchedule.findMany({
    where: {
      paymentType: "UTILITY",
      proposedRenter: {
        renterAccountId: publicAccountId
      }
    },
    orderBy: { dueDate: "desc" },
    select: {
      dueDate: true,
      status: true,
      paidAt: true,
      confirmedAt: true,
      confirmedByRenterAt: true
    }
  });

  const latestSchedule = latestRelevantSchedule(schedules, now);
  if (!latestSchedule) {
    return replaceRentScoreEventsByCodes({
      publicAccountId,
      tx,
      codes: ["UTILITY_PAID_ON_TIME", "UTILITY_PAID_WITHIN_GRACE_PERIOD", UTILITY_MISSED_RULE_CODE],
      newEvent: null
    });
  }

  const daysLate = latestSchedule.status === "PAID"
    ? wholeDaysLate(latestSchedule.dueDate, latestSchedule.paidAt ?? latestSchedule.confirmedAt ?? latestSchedule.confirmedByRenterAt ?? latestSchedule.dueDate)
    : Infinity;

  const nextRuleCode =
    latestSchedule.status !== "PAID"
      ? UTILITY_MISSED_RULE_CODE
      : daysLate <= 0
        ? "UTILITY_PAID_ON_TIME"
        : daysLate <= 60
          ? "UTILITY_PAID_WITHIN_GRACE_PERIOD"
          : UTILITY_MISSED_RULE_CODE;

  return replaceRentScoreEventsByCodes({
    publicAccountId,
    tx,
    codes: ["UTILITY_PAID_ON_TIME", "UTILITY_PAID_WITHIN_GRACE_PERIOD", UTILITY_MISSED_RULE_CODE],
    newEvent: {
      ruleCode: nextRuleCode,
      occurredAt: now,
      sourceNote: "Utility payment status recalculated from payment history."
    }
  });
}

export async function listRenterScores(input: { q?: string; status?: PublicAccountStatus }) {
  await resolvePolicy();

  const where: Prisma.PublicAccountWhereInput = {
    accountType: "RENTER"
  };

  if (input.q) {
    where.OR = [
      { firstName: { contains: input.q, mode: "insensitive" } },
      { lastName: { contains: input.q, mode: "insensitive" } },
      { organizationName: { contains: input.q, mode: "insensitive" } },
      { email: { contains: input.q, mode: "insensitive" } }
    ];
  }

  if (input.status) {
    where.status = input.status;
  }

  const [accounts, scoreRequestCount] = await Promise.all([
    prisma.publicAccount.findMany({
      where,
      orderBy: { createdAt: "desc" }
    }),
    prisma.scoreRequest.count()
  ]);

  const items = await Promise.all(
    accounts.map(async (account: any) => {
      const snapshot = await buildRentScoreSnapshot(account.id);
      return {
        accountId: snapshot.account.id,
        email: snapshot.account.email,
        firstName: snapshot.account.firstName,
        lastName: snapshot.account.lastName,
        organizationName: snapshot.account.organizationName,
        status: snapshot.account.status,
        state: snapshot.account.state,
        city: snapshot.account.city,
        score: snapshot.summary.score,
        rawScore: snapshot.summary.rawScore,
        scoreBand: snapshot.summary.scoreBand,
        positivePoints: snapshot.summary.positivePoints,
        negativePoints: snapshot.summary.negativePoints,
        eventCount: snapshot.summary.eventCount,
        createdAt: snapshot.account.createdAt
      };
    })
  );

  return {
    items,
    summary: {
      scoreRequestCount
    }
  };
}

export async function listPendingIdentityReviews() {
  const accounts = await prisma.publicAccount.findMany({
    where: {
      accountType: "RENTER",
      identityReviewStatus: "PENDING",
      identitySubmittedAt: { not: null }
    },
    orderBy: { identitySubmittedAt: "asc" }
  });

  return {
    items: accounts.map((account) => ({
      accountId: account.id,
      name: publicAccountDisplayName(account),
      email: account.email,
      phone: account.phone,
      state: account.state,
      city: account.city,
      address: account.address,
      identityVerificationType: account.identityVerificationType,
      maskedValue:
        account.identityVerificationType === "NIN"
          ? maskIdentityValue(account.nin)
          : maskIdentityValue(account.bvn),
      submittedAt: account.identitySubmittedAt,
      createdAt: account.createdAt
    }))
  };
}

function maskIdentityValue(value?: string | null) {
  if (!value) return null;
  if (value.length <= 4) return value;
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

export async function reviewIdentitySubmission(input: {
  publicAccountId: string;
  reviewerUserId: string;
  action: "APPROVE" | "FAIL";
  comment?: string;
}) {
  const account = await prisma.publicAccount.findUnique({
    where: { id: input.publicAccountId }
  });

  if (!account || account.accountType !== "RENTER") {
    throw new AppError("Renter account not found", 404, "RENTER_NOT_FOUND");
  }

  if (account.identityReviewStatus !== "PENDING" || !account.identitySubmittedAt || !account.identityVerificationType) {
    throw new AppError("No pending identity review found for this renter", 409, "IDENTITY_REVIEW_NOT_PENDING");
  }

  if (input.action === "FAIL" && !input.comment?.trim()) {
    throw new AppError("A review comment is required when identity verification fails", 400, "VALIDATION_ERROR");
  }

  const reviewedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.publicAccount.update({
      where: { id: account.id },
      data:
        input.action === "APPROVE"
          ? {
              identityReviewStatus: "APPROVED",
              identityReviewedAt: reviewedAt,
              identityReviewedByUserId: input.reviewerUserId,
              identityReviewComment: null,
              ...(account.identityVerificationType === "NIN"
                ? { ninVerifiedAt: reviewedAt }
                : { bvnVerifiedAt: reviewedAt })
            }
          : {
              identityReviewStatus: "FAILED",
              identityReviewedAt: reviewedAt,
              identityReviewedByUserId: input.reviewerUserId,
              identityReviewComment: input.comment?.trim() || null,
              ...(account.identityVerificationType === "NIN"
                ? { ninVerifiedAt: null }
                : { bvnVerifiedAt: null })
            }
    });

    await replaceRentScoreEventsByCodes({
      publicAccountId: account.id,
      tx,
      codes: [GOVERNMENT_ID_RULE_CODE],
      newEvent:
        input.action === "APPROVE"
          ? {
              ruleCode: GOVERNMENT_ID_RULE_CODE,
              occurredAt: reviewedAt,
              recordedByUserId: input.reviewerUserId,
              sourceNote: `${account.identityVerificationType} identity approved by admin`
            }
          : null
    });
  });

  const title =
    input.action === "APPROVE" ? "Identity approved" : "Identity review needs an update";
  const message =
    input.action === "APPROVE"
      ? `Your ${account.identityVerificationType} has been approved. Your renter profile and rent score have been updated.`
      : `Your ${account.identityVerificationType} submission was not approved. ${input.comment?.trim()}`;

  await createPublicAccountNotification({
    publicAccountId: account.id,
    notificationType: "IDENTITY_REVIEW",
    title,
    message,
    ctaLabel: "Open",
    ctaPath: "/account/renter/profile",
    metadata: {
      action: input.action,
      verificationType: account.identityVerificationType,
      comment: input.comment?.trim() || null
    }
  });

  await sendTransactionalMail({
    category: "RENTER_NOTIFICATION",
    to: account.email,
    subject: input.action === "APPROVE" ? "Your identity has been approved" : "Update your identity submission",
    html: renderTransactionalEmail({
      eyebrow: "Identity review",
      title: input.action === "APPROVE" ? "Identity approved" : "Identity review update",
      greeting: `Dear ${publicAccountDisplayName(account)},`,
      paragraphs:
        input.action === "APPROVE"
          ? [
              `Your ${account.identityVerificationType} has been reviewed and approved by the RentSure team.`,
              "Your renter profile now reflects the approved identity check, and the related rent-score points have been applied."
            ]
          : [
              `We reviewed your ${account.identityVerificationType} submission, but we could not approve it yet.`,
              `Reason: ${input.comment?.trim()}`,
              "Please return to your RentSure profile, correct the details, and submit the identity information again for review."
            ],
      ctaLabel: "Open",
      ctaUrl: `${env.APP_WEB_BASE_URL}/account/renter/profile`,
      closing: "Best regards,<br />RentSure Team"
    })
  });

  return buildRentScoreSnapshot(account.id);
}

export async function getRenterScoreDetails(publicAccountId: string) {
  return buildRentScoreSnapshot(publicAccountId);
}

export async function getAuthenticatedRenterScore(publicAccountId: string) {
  return buildRentScoreSnapshot(publicAccountId);
}

export type { RentScoreSnapshot, DefaultRuleDefinition };
