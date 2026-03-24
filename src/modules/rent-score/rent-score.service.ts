import type { Prisma, PublicAccountStatus } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";

const DEFAULT_POLICY_CODE = "DEFAULT";
const REGISTRATION_RULE_CODE = "REGISTRATION_COMPLETED";

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

const defaultRuleDefinitions: DefaultRuleDefinition[] = [
  {
    code: REGISTRATION_RULE_CODE,
    name: "Registration completed",
    description: "Applied once after a renter registers on RentSure.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 10
  },
  {
    code: "BVN_SIN_VALIDATED",
    name: "BVN / SIN validated",
    description: "Applied when a renter's BVN or SIN is validated through RentSure.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 20
  },
  {
    code: "WORK_EVIDENCE_SUBMITTED",
    name: "Evidence of work submitted",
    description: "Applied when a renter submits a payslip or employment document.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 30
  },
  {
    code: "RENT_PAID_ON_TIME",
    name: "Rent paid on time",
    description: "Applied for each rent payment made on time through RentSure.",
    points: 100,
    sortOrder: 40
  },
  {
    code: "ADDITIONAL_RENT_PAYMENT",
    name: "Additional rent payment",
    description: "Applied for extra rent payment activity and capped at four occurrences.",
    points: 25,
    maxOccurrences: 4,
    sortOrder: 50
  },
  {
    code: "AFFORDABLE_RENT_RATIO",
    name: "Affordable rent ratio",
    description: "Applied when rent is below 35% of average family or individual salary.",
    points: 50,
    maxOccurrences: 1,
    sortOrder: 60
  },
  {
    code: "STABLE_SALARY_INFLOWS",
    name: "Stable salary inflows",
    description: "Applied when salary inflows are stable for at least six months.",
    points: 50,
    maxOccurrences: 1,
    sortOrder: 70
  },
  {
    code: "ADDRESS_STABILITY_OVER_2_YEARS",
    name: "Address stability over 2 years",
    description: "Applied when a renter has stayed at the same address for more than two years.",
    points: 50,
    maxOccurrences: 1,
    sortOrder: 80
  },
  {
    code: "NO_PROPERTY_DAMAGE_REPORT",
    name: "No property damage report",
    description: "Applied when there is no documented property damage against the renter.",
    points: 50,
    maxOccurrences: 1,
    sortOrder: 90
  },
  {
    code: "SPOUSE_INCOME_VERIFIED",
    name: "Spouse income verified",
    description: "Applied once when spouse income is verified.",
    points: 100,
    maxOccurrences: 1,
    sortOrder: 100
  },
  {
    code: "CONSISTENT_UTILITY_PAYMENT",
    name: "Consistent utility payment",
    description: "Applied for consistent utility bill payment and capped at four occurrences.",
    points: 25,
    maxOccurrences: 4,
    sortOrder: 110
  },
  {
    code: "MISSED_FULL_YEAR_RENT_PAYMENT",
    name: "Missed full year rent payment",
    description: "Deducted for each missed full-year rent payment.",
    points: -100,
    sortOrder: 120
  },
  {
    code: "PROPERTY_MISUSE_REPORTED",
    name: "Property misuse reported",
    description: "Deducted when a previous landlord or verified user reports property misuse.",
    points: -100,
    sortOrder: 130
  },
  {
    code: "MISSED_UTILITY_PAYMENT",
    name: "Missed utility payment",
    description: "Deducted for each missed utility payment.",
    points: -50,
    sortOrder: 140
  }
];

type DbClient = any;

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

async function fetchPolicyWithRules(tx: DbClient) {
  return tx.rentScorePolicy.findUnique({
    where: { code: DEFAULT_POLICY_CODE },
    include: {
      rules: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      }
    }
  });
}

export async function ensureDefaultRentScorePolicy(tx: DbClient = prisma) {
  const policy = await tx.rentScorePolicy.upsert({
    where: { code: DEFAULT_POLICY_CODE },
    update: {},
    create: {
      code: DEFAULT_POLICY_CODE,
      name: "Rent score default policy",
      description: "Default RentSure rent score policy for renters.",
      minScore: 0,
      maxScore: 900,
      isActive: true
    }
  });

  const existingRules = await tx.rentScoreRule.findMany({
    where: { policyId: policy.id },
    select: { code: true }
  });

  const existingCodes = new Set(existingRules.map((rule: { code: string }) => rule.code));
  const missingRules = defaultRuleDefinitions.filter((rule) => !existingCodes.has(rule.code));

  if (missingRules.length > 0) {
    await tx.rentScoreRule.createMany({
      data: missingRules.map((rule) => ({
        policyId: policy.id,
        code: rule.code,
        name: rule.name,
        description: rule.description,
        points: rule.points,
        maxOccurrences: rule.maxOccurrences ?? null,
        sortOrder: rule.sortOrder,
        metadata: rule.metadata
      }))
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
  const account = await resolveRenterAccount(publicAccountId, tx);
  const events = await tx.rentScoreEvent.findMany({
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
  });

  const summaryByRuleId = new Map<
    string,
    {
      quantity: number;
      lastOccurredAt: Date | null;
    }
  >();

  for (const event of events) {
    const current = summaryByRuleId.get(event.ruleId) ?? { quantity: 0, lastOccurredAt: null };
    current.quantity += event.quantity;
    if (!current.lastOccurredAt || event.occurredAt > current.lastOccurredAt) {
      current.lastOccurredAt = event.occurredAt;
    }
    summaryByRuleId.set(event.ruleId, current);
  }

  const breakdown = policy.rules.map((rule: any) => {
    const eventSummary = summaryByRuleId.get(rule.id) ?? { quantity: 0, lastOccurredAt: null };
    const trackedOccurrences = eventSummary.quantity;
    const appliedOccurrences =
      rule.isActive && rule.maxOccurrences ? Math.min(trackedOccurrences, rule.maxOccurrences) : rule.isActive ? trackedOccurrences : 0;
    const contribution = rule.isActive ? rule.points * appliedOccurrences : 0;

    return {
      ruleId: rule.id,
      code: rule.code,
      name: rule.name,
      description: rule.description,
      points: rule.points,
      maxOccurrences: rule.maxOccurrences,
      isActive: rule.isActive,
      quantity: trackedOccurrences,
      appliedOccurrences,
      contribution,
      lastOccurredAt: eventSummary.lastOccurredAt
    };
  });

  const rawScore = breakdown.reduce((total: number, item: any) => total + item.contribution, 0);
  const score = clampScore(rawScore, policy.minScore, policy.maxScore);
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
      maxScore: policy.maxScore,
      positivePoints,
      negativePoints,
      eventCount: events.length,
      scoreBand: scoreBand(score)
    },
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

export async function getRentScoreConfig() {
  const policy = await resolvePolicy();
  return {
    id: policy.id,
    code: policy.code,
    name: policy.name,
    description: policy.description,
    minScore: policy.minScore,
    maxScore: policy.maxScore,
    isActive: policy.isActive,
    updatedAt: policy.updatedAt,
    rules: policy.rules.map((rule: any) => ({
      id: rule.id,
      code: rule.code,
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
  const existing = await prisma.rentScoreRule.findUnique({ where: { id: ruleId } });
  if (!existing) {
    throw new AppError("Rent score rule not found", 404, "RENT_SCORE_RULE_NOT_FOUND");
  }

  await prisma.rentScoreRule.update({
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

  return getRentScoreConfig();
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

export async function getRenterScoreDetails(publicAccountId: string) {
  return buildRentScoreSnapshot(publicAccountId);
}

export async function getAuthenticatedRenterScore(publicAccountId: string) {
  return buildRentScoreSnapshot(publicAccountId);
}

export type { RentScoreSnapshot, DefaultRuleDefinition };
