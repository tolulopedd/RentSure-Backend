import type {
  PaymentScheduleStatus,
  PaymentScheduleType,
  Prisma,
  PropertyMemberRole,
  PublicAccount,
  PublicAccountType
} from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { logger } from "../../common/logger/logger";
import { env } from "../../config/env";
import { buildRentScoreSnapshot } from "../rent-score/rent-score.service";
import { attachPassportPhotoToPublicAccount, toPublicDocumentAsset } from "../storage/storage.service";
import { createMailPreview } from "../mail-preview/mail-preview.service";

type DbClient = Prisma.TransactionClient | typeof prisma;
type ProposedRenterDecision = "APPROVED" | "HOLD" | "DECLINED";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function publicAccountDisplayName(account: Pick<PublicAccount, "firstName" | "lastName" | "organizationName">) {
  if (account.organizationName?.trim()) return account.organizationName.trim();
  return [account.firstName, account.lastName].filter(Boolean).join(" ") || "Unnamed account";
}

function propertySummary(property: {
  name: string;
  propertyType?: string | null;
  bedroomCount?: number | null;
}) {
  const typeLabel = property.propertyType === "Flats" ? "Flat" : property.propertyType || "Property";
  const bedroomLabel = `${property.bedroomCount || 1} Bedroom`;
  return `${bedroomLabel} ${typeLabel} at ${property.name}`;
}

function addDateByFrequency(date: Date, frequency: "MONTHLY" | "QUARTERLY" | "YEARLY", step = 1) {
  const next = new Date(date);
  if (frequency === "MONTHLY") {
    next.setMonth(next.getMonth() + step);
    return next;
  }
  if (frequency === "QUARTERLY") {
    next.setMonth(next.getMonth() + step * 3);
    return next;
  }
  next.setFullYear(next.getFullYear() + step);
  return next;
}

function buildRenterInviteUrl(email: string) {
  const base = env.APP_WEB_BASE_URL.replace(/\/+$/, "");
  return `${base}/signup?track=RENTER&email=${encodeURIComponent(email)}`;
}

async function getWorkspaceAccount(publicAccountId: string, tx: DbClient = prisma) {
  const account = await tx.publicAccount.findUnique({ where: { id: publicAccountId } });
  if (!account || account.status !== "ACTIVE") {
    throw new AppError("Workspace account not found", 404, "WORKSPACE_ACCOUNT_NOT_FOUND");
  }
  if (account.accountType !== "AGENT" && account.accountType !== "LANDLORD") {
    throw new AppError("This workspace is only available to agents and landlords", 403, "FORBIDDEN");
  }
  return account;
}

function toWorkspaceProfilePayload(account: PublicAccount & { passportPhotoDocument?: Prisma.PublicAccountDocumentGetPayload<{}> | null }) {
  return {
    profile: {
      id: account.id,
      accountType: account.accountType,
      entityType: account.entityType,
      representation: account.representation,
      firstName: account.firstName,
      lastName: account.lastName,
      organizationName: account.organizationName,
      registrationNumber: account.registrationNumber,
      email: account.email,
      phone: account.phone,
      state: account.state,
      city: account.city,
      address: account.address,
      propertyCount: account.propertyCount,
      portfolioType: account.portfolioType,
      notes: account.notes,
      status: account.status,
      passportPhoto: toPublicDocumentAsset(account.passportPhotoDocument),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    }
  };
}

async function getPropertyMembership(publicAccountId: string, propertyId: string, tx: DbClient = prisma) {
  await getWorkspaceAccount(publicAccountId, tx);

  const membership = await tx.propertyMember.findFirst({
    where: {
      propertyId,
      publicAccountId
    },
    include: {
      property: {
        include: {
          members: {
            include: {
              account: true
            }
          }
        }
      }
    }
  });

  if (!membership) {
    throw new AppError("Property not linked to this workspace", 404, "PROPERTY_NOT_FOUND");
  }

  return membership;
}

async function getAccessibleProposedRenter(publicAccountId: string, proposedRenterId: string, tx: DbClient = prisma): Promise<any> {
  await getWorkspaceAccount(publicAccountId, tx);

  const renter = await tx.proposedRenter.findFirst({
    where: {
      id: proposedRenterId,
      property: {
        members: {
          some: {
            publicAccountId
          }
        }
      }
    },
    include: {
      decisionBy: true,
      property: {
        include: {
          members: {
            include: {
              account: true
            }
          }
        }
      }
    }
  } as any);

  if (!renter) {
    throw new AppError("Proposed renter not found", 404, "PROPOSED_RENTER_NOT_FOUND");
  }

  return renter;
}

async function mapLinkedRentScore(renterAccountId?: string | null) {
  if (!renterAccountId) return null;
  try {
    const snapshot = await buildRentScoreSnapshot(renterAccountId);
    return {
      score: snapshot.summary.score,
      scoreBand: snapshot.summary.scoreBand,
      positivePoints: snapshot.summary.positivePoints,
      negativePoints: snapshot.summary.negativePoints,
      eventCount: snapshot.summary.eventCount
    };
  } catch {
    return null;
  }
}

async function getLinkedRentScoreReport(renterAccountId?: string | null) {
  if (!renterAccountId) return null;
  try {
    const snapshot = await buildRentScoreSnapshot(renterAccountId);
    return {
      summary: snapshot.summary,
      policy: snapshot.policy,
      breakdown: snapshot.breakdown
    };
  } catch {
    return null;
  }
}

function memberSummary(member: {
  role: PropertyMemberRole;
  account: PublicAccount;
  isPrimary: boolean;
}) {
  return {
    role: member.role,
    isPrimary: member.isPrimary,
    accountId: member.account.id,
    accountType: member.account.accountType,
    name: publicAccountDisplayName(member.account),
    email: member.account.email,
    phone: member.account.phone
  };
}

async function logProposedRenterActivity(input: {
  proposedRenterId: string;
  actorAccountId?: string | null;
  activityType:
    | "COMMENT"
    | "CREATED"
    | "SCORE_REQUESTED"
    | "SCORE_FORWARDED"
    | "DECISION"
    | "PAYMENT_SCHEDULE_CREATED"
    | "PAYMENT_SCHEDULE_UPDATED"
    | "RENTER_PAYMENT_CONFIRMED";
  message: string;
  metadata?: Prisma.JsonObject;
  tx?: DbClient;
}) {
  const client = input.tx ?? prisma;
  await client.proposedRenterActivity.create({
    data: {
      proposedRenterId: input.proposedRenterId,
      actorAccountId: input.actorAccountId ?? null,
      activityType: input.activityType,
      message: input.message,
      metadata: input.metadata
    }
  });
}

async function notifyProposedRenter(input: {
  requestedByAccountId: string;
  propertySummaryLabel: string;
  renterEmail: string;
  renterName: string;
  existingAccountId?: string | null;
}) {
  const isExistingMember = Boolean(input.existingAccountId);
  const actionUrl = `${env.APP_WEB_BASE_URL.replace(/\/+$/, "")}${isExistingMember ? "/account/renter/queue" : "/signup"}`;
  const preview = createMailPreview({
    category: isExistingMember ? "RENTER_NOTIFICATION" : "RENTER_INVITE",
    to: input.renterEmail,
    subject: isExistingMember ? "A property has been linked to your RentSure profile" : "Complete your RentSure renter profile",
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a;">
        <p style="font-size: 14px; color: #475569;">Hello ${input.renterName || "there"},</p>
        <p style="font-size: 14px; line-height: 1.7; color: #334155;">
          ${
            isExistingMember
              ? `A landlord or agent has linked you to <strong>${input.propertySummaryLabel}</strong> on RentSure.`
              : `A landlord or agent has proposed you for <strong>${input.propertySummaryLabel}</strong> on RentSure.`
          }
        </p>
        <p style="font-size: 14px; line-height: 1.7; color: #334155;">
          ${
            isExistingMember
              ? "Open your renter workspace to review the linked property, rent score progress, and payment schedules."
              : "Please complete your renter profile within 1-2 days so the property owner can continue your rent score review."
          }
        </p>
        <p style="margin: 28px 0;">
          <a href="${actionUrl}" style="display: inline-block; border-radius: 12px; background: #1d4ed8; color: white; padding: 12px 18px; text-decoration: none; font-weight: 600;">
            ${isExistingMember ? "Open renter workspace" : "Complete renter profile"}
          </a>
        </p>
      </div>
    `
  });

  if (input.existingAccountId) {
    logger.info(
      {
        event: "workspace.renter_notification",
        renterAccountId: input.existingAccountId,
        renterEmail: input.renterEmail,
        requestedByAccountId: input.requestedByAccountId,
        property: input.propertySummaryLabel,
        previewUrl: preview.previewUrl
      },
      "Existing renter linked to proposed renter case"
    );
    return {
      mode: "EXISTING_MEMBER" as const,
      invitePreviewUrl: process.env.NODE_ENV === "production" ? null : preview.previewUrl
    };
  }

  const inviteUrl = buildRenterInviteUrl(input.renterEmail);
  logger.info(
    {
      event: "workspace.renter_invite",
      renterEmail: input.renterEmail,
      renterName: input.renterName,
      requestedByAccountId: input.requestedByAccountId,
      property: input.propertySummaryLabel,
      inviteUrl,
      previewUrl: preview.previewUrl
    },
    "Proposed renter invite generated"
  );

  return {
    mode: "NEW_INVITE" as const,
    invitePreviewUrl: process.env.NODE_ENV === "production" ? null : preview.previewUrl
  };
}

function canUseExistingRenterAccount(account?: PublicAccount | null) {
  return Boolean(account && account.accountType === "RENTER" && account.status !== "DISABLED");
}

export async function getWorkspaceOverview(publicAccountId: string) {
  await getWorkspaceAccount(publicAccountId);

  const properties = await prisma.propertyMember.findMany({
    where: { publicAccountId },
    include: {
      property: {
        include: {
          members: {
            include: {
              account: true
            }
          },
          units: {
            orderBy: { createdAt: "asc" }
          }
        }
      }
    },
    orderBy: {
      property: {
        createdAt: "desc"
      }
    }
  });

  const propertyIds = properties.map((entry) => entry.propertyId);

  const [proposedRenterCount, scoreRequestCount, pendingScheduleCount, recentRenters] = await Promise.all([
    prisma.proposedRenter.count({
      where: {
        propertyId: { in: propertyIds.length ? propertyIds : ["__none__"] }
      }
    }),
    prisma.scoreRequest.count({
      where: {
        proposedRenter: {
          propertyId: { in: propertyIds.length ? propertyIds : ["__none__"] }
        }
      }
    }),
    prisma.paymentSchedule.count({
      where: {
        propertyId: { in: propertyIds.length ? propertyIds : ["__none__"] },
        status: "PENDING"
      }
    }),
    prisma.proposedRenter.findMany({
      where: {
        propertyId: { in: propertyIds.length ? propertyIds : ["__none__"] }
      },
      include: {
        property: true
      },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  const recentItems = await Promise.all(
    recentRenters.map(async (item) => ({
      id: item.id,
      name: item.organizationName || [item.firstName, item.lastName].filter(Boolean).join(" "),
      email: item.email,
      status: item.status,
      propertyName: propertySummary(item.property),
      propertyAddress: item.property.address,
      linkedRentScore: await mapLinkedRentScore(item.renterAccountId),
      createdAt: item.createdAt
    }))
  );

  return {
    summary: {
      propertyCount: properties.length,
      proposedRenterCount,
      scoreRequestCount,
      pendingScheduleCount
    },
    properties: properties.map((entry) => ({
      id: entry.property.id,
      name: entry.property.name,
      summaryLabel: propertySummary(entry.property),
      ownerName: entry.property.ownerName,
      landlordEmail: entry.property.landlordEmail,
      address: entry.property.address,
      city: entry.property.city,
      state: entry.property.state,
      propertyType: entry.property.propertyType,
      bedroomCount: entry.property.bedroomCount,
      bathroomCount: entry.property.bathroomCount,
      toiletCount: entry.property.toiletCount,
      unitCount: entry.property.unitCount,
      membershipRole: entry.role,
      members: entry.property.members.map(memberSummary),
      units: entry.property.units.map((unit) => ({
        id: unit.id,
        label: unit.label,
        address: unit.address,
        city: unit.city,
        state: unit.state
      }))
    })),
    recentRenters: recentItems
  };
}

export async function getWorkspaceProfile(publicAccountId: string) {
  const account = await prisma.publicAccount.findUnique({
    where: { id: publicAccountId },
    include: {
      passportPhotoDocument: true
    }
  });

  if (!account || account.status !== "ACTIVE" || (account.accountType !== "LANDLORD" && account.accountType !== "AGENT")) {
    throw new AppError("Workspace account not found", 404, "WORKSPACE_ACCOUNT_NOT_FOUND");
  }

  return toWorkspaceProfilePayload(account);
}

export async function updateWorkspaceProfile(input: {
  publicAccountId: string;
  accountType?: "LANDLORD" | "AGENT";
  representation?: string | null;
  firstName?: string;
  lastName?: string;
  organizationName?: string | null;
  registrationNumber?: string | null;
  phone?: string;
  state?: string;
  city?: string;
  address?: string;
  propertyCount?: string | null;
  portfolioType?: string | null;
  notes?: string | null;
}) {
  await getWorkspaceAccount(input.publicAccountId);

  await prisma.publicAccount.update({
    where: { id: input.publicAccountId },
    data: {
      accountType: input.accountType,
      representation: input.representation === undefined ? undefined : input.representation?.trim() || null,
      firstName: input.firstName?.trim(),
      lastName: input.lastName?.trim(),
      organizationName: input.organizationName === undefined ? undefined : input.organizationName?.trim() || null,
      registrationNumber: input.registrationNumber === undefined ? undefined : input.registrationNumber?.trim() || null,
      phone: input.phone?.trim(),
      state: input.state?.trim(),
      city: input.city?.trim(),
      address: input.address?.trim(),
      propertyCount: input.propertyCount === undefined ? undefined : input.propertyCount?.trim() || null,
      portfolioType: input.portfolioType === undefined ? undefined : input.portfolioType?.trim() || null,
      notes: input.notes === undefined ? undefined : input.notes?.trim() || null
    }
  });

  return getWorkspaceProfile(input.publicAccountId);
}

export async function saveWorkspacePassportPhoto(input: {
  publicAccountId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}) {
  await getWorkspaceAccount(input.publicAccountId);
  await attachPassportPhotoToPublicAccount(input);
  return getWorkspaceProfile(input.publicAccountId);
}

export async function listWorkspaceProperties(publicAccountId: string) {
  await getWorkspaceAccount(publicAccountId);

  const items = await prisma.propertyMember.findMany({
    where: { publicAccountId },
    include: {
      property: {
        include: {
          members: {
            include: { account: true }
          },
          units: {
            orderBy: { createdAt: "asc" }
          },
          proposedRenters: {
            orderBy: { createdAt: "desc" }
          }
        }
      }
    },
    orderBy: {
      property: {
        createdAt: "desc"
      }
    }
  });

  return {
    items: items.map((entry) => ({
      id: entry.property.id,
      name: entry.property.name,
      summaryLabel: propertySummary(entry.property),
      ownerName: entry.property.ownerName,
      landlordEmail: entry.property.landlordEmail,
      address: entry.property.address,
      city: entry.property.city,
      state: entry.property.state,
      propertyType: entry.property.propertyType,
      bedroomCount: entry.property.bedroomCount,
      bathroomCount: entry.property.bathroomCount,
      toiletCount: entry.property.toiletCount,
      unitCount: entry.property.unitCount,
      membershipRole: entry.role,
      createdAt: entry.property.createdAt,
      members: entry.property.members.map(memberSummary),
      proposedRenterCount: entry.property.proposedRenters.length,
      units: entry.property.units.map((unit) => ({
        id: unit.id,
        label: unit.label,
        address: unit.address,
        city: unit.city,
        state: unit.state
      }))
    }))
  };
}

export async function createWorkspaceProperty(input: {
  publicAccountId: string;
  name: string;
  ownerName: string;
  landlordEmail: string;
  propertyType: string;
  bedroomCount: number;
  bathroomCount: number;
  toiletCount: number;
  unitCount: number;
  units: Array<{
    label: string;
    address: string;
    state: string;
    city: string;
  }>;
}) {
  return prisma.$transaction(async (tx) => {
    const account = await getWorkspaceAccount(input.publicAccountId, tx);
    const normalizedLandlordEmail = normalizeEmail(input.landlordEmail);
    const landlordAccount = await tx.publicAccount.findUnique({
      where: { email: normalizedLandlordEmail }
    });

    if (!landlordAccount || landlordAccount.status !== "ACTIVE" || landlordAccount.accountType !== "LANDLORD") {
      throw new AppError("Landlord email must belong to an active landlord account", 400, "INVALID_LANDLORD_EMAIL");
    }

    if (account.accountType === "LANDLORD" && landlordAccount.id !== account.id) {
      throw new AppError("Landlord properties must be linked to your verified landlord email", 400, "INVALID_LANDLORD_EMAIL");
    }

    const normalizedUnits = input.units.map((unit, index) => ({
      label: unit.label.trim() || `Unit ${index + 1}`,
      address: unit.address.trim(),
      state: unit.state.trim(),
      city: unit.city.trim()
    }));
    const primaryUnit = normalizedUnits[0];

    const property = await tx.property.create({
      data: {
        name: input.name.trim(),
        ownerName: input.ownerName.trim(),
        landlordEmail: normalizedLandlordEmail,
        address: primaryUnit.address,
        state: primaryUnit.state,
        city: primaryUnit.city,
        propertyType: input.propertyType.trim(),
        bedroomCount: input.bedroomCount,
        bathroomCount: input.bathroomCount,
        toiletCount: input.toiletCount,
        unitCount: input.unitCount,
        createdByAccountId: input.publicAccountId
      }
    });

    await tx.propertyMember.upsert({
      where: {
        propertyId_publicAccountId_role: {
          propertyId: property.id,
          publicAccountId: landlordAccount.id,
          role: "LANDLORD"
        }
      },
      update: {
        isPrimary: true
      },
      create: {
        propertyId: property.id,
        publicAccountId: landlordAccount.id,
        role: "LANDLORD",
        isPrimary: true
      }
    });

    if (account.accountType === "AGENT") {
      await tx.propertyMember.upsert({
        where: {
          propertyId_publicAccountId_role: {
            propertyId: property.id,
            publicAccountId: account.id,
            role: "AGENT"
          }
        },
        update: {
          isPrimary: true
        },
        create: {
          propertyId: property.id,
          publicAccountId: account.id,
          role: "AGENT",
          isPrimary: true
        }
      });
    }

    await tx.propertyUnit.createMany({
      data: normalizedUnits.map((unit) => ({
        propertyId: property.id,
        label: unit.label,
        address: unit.address,
        state: unit.state,
        city: unit.city
      }))
    });

    return getWorkspaceOverview(input.publicAccountId);
  });
}

export async function shareWorkspaceProperty(input: {
  publicAccountId: string;
  propertyId: string;
  sharedWithEmail: string;
}) {
  return prisma.$transaction(async (tx) => {
    const currentAccount = await getWorkspaceAccount(input.publicAccountId, tx);
    const membership = await getPropertyMembership(input.publicAccountId, input.propertyId, tx);
    const partner = await tx.publicAccount.findUnique({
      where: { email: normalizeEmail(input.sharedWithEmail) }
    });

    if (!partner || partner.status !== "ACTIVE") {
      throw new AppError("Shared account was not found or is not active", 404, "SHARED_ACCOUNT_NOT_FOUND");
    }

    const expectedType: PublicAccountType = currentAccount.accountType === "AGENT" ? "LANDLORD" : "AGENT";
    if (partner.accountType !== expectedType) {
      throw new AppError(`Shared account must be an active ${expectedType.toLowerCase()} account`, 400, "INVALID_SHARED_ACCOUNT");
    }

    await tx.propertyMember.upsert({
      where: {
        propertyId_publicAccountId_role: {
          propertyId: membership.propertyId,
          publicAccountId: partner.id,
          role: expectedType === "AGENT" ? "AGENT" : "LANDLORD"
        }
      },
      update: {},
      create: {
        propertyId: membership.propertyId,
        publicAccountId: partner.id,
        role: expectedType === "AGENT" ? "AGENT" : "LANDLORD",
        isPrimary: false
      }
    });

    return listWorkspaceProperties(input.publicAccountId);
  });
}

export async function listWorkspaceQueue(publicAccountId: string) {
  await getWorkspaceAccount(publicAccountId);

  const items: any[] = await prisma.proposedRenter.findMany({
    where: {
      property: {
        members: {
          some: {
            publicAccountId
          }
        }
      }
    },
    include: {
      decisionBy: true,
      property: {
        include: {
          members: {
            include: {
              account: true
            }
          }
        }
      },
      scoreRequests: {
        include: {
          requestedBy: true,
          forwardedTo: true
        },
        orderBy: { createdAt: "desc" }
      },
      paymentSchedules: {
        orderBy: { dueDate: "asc" },
        take: 4
      }
    },
    orderBy: { createdAt: "desc" }
  } as any);

  return {
    items: await Promise.all(
      items.map(async (item) => ({
        id: item.id,
        firstName: item.firstName,
        lastName: item.lastName,
        organizationName: item.organizationName,
        email: item.email,
        phone: item.phone,
        address: item.address,
        city: item.city,
        state: item.state,
        status: item.status,
        property: {
          id: item.property.id,
          name: item.property.name,
          summaryLabel: propertySummary(item.property),
          address: item.property.address,
          city: item.property.city,
          state: item.property.state,
          bedroomCount: item.property.bedroomCount,
          bathroomCount: item.property.bathroomCount,
          toiletCount: item.property.toiletCount,
          members: item.property.members.map(memberSummary)
        },
        linkedRentScore: await mapLinkedRentScore(item.renterAccountId),
        decision: item.decision
          ? {
              decision: item.decision,
              decidedAt: item.decisionAt,
              decidedByName: item.decisionBy ? publicAccountDisplayName(item.decisionBy) : null,
              note: item.decisionNote
            }
          : null,
        latestScoreRequest: item.scoreRequests[0]
          ? {
              id: item.scoreRequests[0].id,
              status: item.scoreRequests[0].status,
              notes: item.scoreRequests[0].notes,
              createdAt: item.scoreRequests[0].createdAt,
              requestedBy: publicAccountDisplayName(item.scoreRequests[0].requestedBy),
              forwardedTo: item.scoreRequests[0].forwardedTo ? publicAccountDisplayName(item.scoreRequests[0].forwardedTo) : null
            }
          : null,
        paymentSchedules: item.paymentSchedules.map((schedule: any) => ({
          id: schedule.id,
          paymentType: schedule.paymentType,
          amountNgn: schedule.amountNgn,
          dueDate: schedule.dueDate,
          status: schedule.status
        })),
        createdAt: item.createdAt
      }))
    )
  };
}

export async function searchWorkspaceRenters(input: {
  publicAccountId: string;
  propertyId: string;
  q: string;
}) {
  await getPropertyMembership(input.publicAccountId, input.propertyId);

  const q = input.q.trim();
  if (q.length < 2) {
    return { items: [] };
  }

  const [accounts, existingMatches] = await Promise.all([
    prisma.publicAccount.findMany({
      where: {
        accountType: "RENTER",
        status: { not: "DISABLED" },
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { organizationName: { contains: q, mode: "insensitive" } }
        ]
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 8
    }),
    prisma.proposedRenter.findMany({
      where: {
        propertyId: input.propertyId
      },
      select: {
        renterAccountId: true,
        email: true
      }
    })
  ]);

  const linkedAccountIds = new Set(existingMatches.map((item) => item.renterAccountId).filter(Boolean));
  const linkedEmails = new Set(existingMatches.map((item) => normalizeEmail(item.email)));

  return {
    items: accounts.map((account) => ({
      id: account.id,
      firstName: account.firstName,
      lastName: account.lastName,
      organizationName: account.organizationName,
      email: account.email,
      phone: account.phone,
      state: account.state,
      city: account.city,
      address: account.address,
      status: account.status,
      alreadyQueued: linkedAccountIds.has(account.id) || linkedEmails.has(normalizeEmail(account.email))
    }))
  };
}

export async function getWorkspaceQueueItem(publicAccountId: string, proposedRenterId: string, tx: DbClient = prisma) {
  const item = await getAccessibleProposedRenter(publicAccountId, proposedRenterId, tx);

  const [scoreRequests, paymentSchedules, linkedRentScore] = await Promise.all([
    tx.scoreRequest.findMany({
      where: { proposedRenterId },
      include: {
        requestedBy: true,
        forwardedTo: true
      },
      orderBy: { createdAt: "desc" }
    }),
    tx.paymentSchedule.findMany({
      where: { proposedRenterId },
      include: {
        createdBy: true
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }]
    }),
    mapLinkedRentScore(item.renterAccountId)
  ]);

  const linkedRentScoreReport = await getLinkedRentScoreReport(item.renterAccountId);
  const activities = await tx.proposedRenterActivity.findMany({
    where: { proposedRenterId },
    include: {
      actor: true
    },
    orderBy: { createdAt: "desc" }
  });

  return {
    id: item.id,
    firstName: item.firstName,
    lastName: item.lastName,
    organizationName: item.organizationName,
    email: item.email,
    phone: item.phone,
    address: item.address,
    city: item.city,
    state: item.state,
    status: item.status,
    notes: item.notes,
    linkedRentScore,
    linkedRentScoreReport,
    decision: item.decision
      ? {
          decision: item.decision,
          decidedAt: item.decisionAt,
          note: item.decisionNote,
          decidedBy: item.decisionBy
            ? {
                id: item.decisionBy.id,
                name: publicAccountDisplayName(item.decisionBy),
                email: item.decisionBy.email
              }
            : null
        }
      : null,
    property: {
      id: item.property.id,
      name: item.property.name,
      summaryLabel: propertySummary(item.property),
      address: item.property.address,
      city: item.property.city,
      state: item.property.state,
      propertyType: item.property.propertyType,
      bedroomCount: item.property.bedroomCount,
      bathroomCount: item.property.bathroomCount,
      toiletCount: item.property.toiletCount,
      members: item.property.members.map(memberSummary)
    },
    scoreRequests: scoreRequests.map((request) => ({
      id: request.id,
      status: request.status,
      notes: request.notes,
      createdAt: request.createdAt,
      forwardedAt: request.forwardedAt,
      reviewedAt: request.reviewedAt,
      requestedBy: {
        id: request.requestedBy.id,
        name: publicAccountDisplayName(request.requestedBy),
        email: request.requestedBy.email
      },
      forwardedTo: request.forwardedTo
        ? {
            id: request.forwardedTo.id,
            name: publicAccountDisplayName(request.forwardedTo),
            email: request.forwardedTo.email
          }
        : null
    })),
    paymentSchedules: paymentSchedules.map((schedule) => ({
      id: schedule.id,
      paymentType: schedule.paymentType,
      amountNgn: schedule.amountNgn,
      dueDate: schedule.dueDate,
      status: schedule.status,
      note: schedule.note,
      paidAt: schedule.paidAt,
      createdBy: {
        id: schedule.createdBy.id,
        name: publicAccountDisplayName(schedule.createdBy),
        email: schedule.createdBy.email
      }
    })),
    activities: activities.map((activity) => ({
      id: activity.id,
      activityType: activity.activityType,
      message: activity.message,
      createdAt: activity.createdAt,
      actor: activity.actor
        ? {
            id: activity.actor.id,
            name: publicAccountDisplayName(activity.actor),
            email: activity.actor.email
          }
        : null
    })),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

export async function createWorkspaceProposedRenter(input: {
  publicAccountId: string;
  propertyId: string;
  renterAccountId?: string;
  firstName: string;
  lastName: string;
  organizationName?: string;
  email: string;
  phone: string;
  address?: string;
  state?: string;
  city?: string;
  notes?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const membership = await getPropertyMembership(input.publicAccountId, input.propertyId, tx);

    const matchedAccount = input.renterAccountId
      ? await tx.publicAccount.findUnique({
          where: { id: input.renterAccountId }
        })
      : await tx.publicAccount.findUnique({
          where: { email: normalizeEmail(input.email) }
        });
    const linkedAccount = canUseExistingRenterAccount(matchedAccount) ? matchedAccount : null;
    const renterEmail = linkedAccount?.email || normalizeEmail(input.email);
    const renterName = linkedAccount
      ? publicAccountDisplayName(linkedAccount)
      : [input.firstName.trim(), input.lastName.trim()].filter(Boolean).join(" ");

    const existingRenter = await tx.proposedRenter.findFirst({
      where: linkedAccount
        ? {
            propertyId: input.propertyId,
            OR: [{ renterAccountId: linkedAccount.id }, { email: renterEmail }]
          }
        : {
            propertyId: input.propertyId,
            email: renterEmail
          },
      select: {
        id: true
      }
    });

    if (existingRenter) {
      throw new AppError("This renter is already attached to the selected property queue", 409, "RENTER_ALREADY_QUEUED");
    }

    const renter = await tx.proposedRenter.create({
      data: {
        propertyId: input.propertyId,
        renterAccountId: linkedAccount?.accountType === "RENTER" ? linkedAccount.id : null,
        requestedByAccountId: input.publicAccountId,
        firstName: linkedAccount?.firstName || input.firstName.trim(),
        lastName: linkedAccount?.lastName || input.lastName.trim(),
        organizationName: linkedAccount?.organizationName || input.organizationName?.trim() || null,
        email: renterEmail,
        phone: linkedAccount?.phone || input.phone.trim(),
        address: linkedAccount?.address || input.address?.trim() || "",
        state: linkedAccount?.state || input.state?.trim() || "",
        city: linkedAccount?.city || input.city?.trim() || "",
        notes: input.notes?.trim() || null
      }
    });

    const inviteState = await notifyProposedRenter({
      requestedByAccountId: input.publicAccountId,
      propertySummaryLabel: propertySummary(membership.property),
      renterEmail,
      renterName,
      existingAccountId: linkedAccount?.status === "ACTIVE" ? linkedAccount.id : null
    });

    await logProposedRenterActivity({
      proposedRenterId: renter.id,
      actorAccountId: input.publicAccountId,
      activityType: "CREATED",
      message: `Proposed renter profile created for ${renter.organizationName || `${renter.firstName} ${renter.lastName}`}.`,
      metadata: inviteState.invitePreviewUrl ? ({ invitePreviewUrl: inviteState.invitePreviewUrl } as Prisma.JsonObject) : undefined,
      tx
    });

    await logProposedRenterActivity({
      proposedRenterId: renter.id,
      actorAccountId: input.publicAccountId,
      activityType: "COMMENT",
      message:
        inviteState.mode === "EXISTING_MEMBER"
          ? "Existing RentSure member linked to this case. The renter can review the request in their dashboard."
          : "Invite queued for this renter. Full profile details should be provided within 1-2 days.",
      tx
    });

    const detail = await getWorkspaceQueueItem(input.publicAccountId, renter.id, tx);
    return {
      ...detail,
      invitePreviewUrl: inviteState.invitePreviewUrl
    };
  });
}

export async function listPendingRenterInvites() {
  const items = await prisma.proposedRenter.findMany({
    where: {
      OR: [
        { renterAccountId: null },
        {
          renterAccount: {
            status: "UNVERIFIED"
          }
        }
      ]
    },
    include: {
      property: true,
      requestedBy: true,
      renterAccount: true,
      activities: {
        orderBy: { createdAt: "desc" },
        take: 6
      }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return {
    items: items.map((item) => {
      const reminderActivity = item.activities.find((activity) => activity.message.toLowerCase().includes("reminder"));
      return {
        id: item.id,
        firstName: item.firstName,
        lastName: item.lastName,
        organizationName: item.organizationName,
        email: item.email,
        phone: item.phone,
        inviteState: item.renterAccount?.status === "UNVERIFIED" ? "UNVERIFIED_ACCOUNT" : "INVITED",
        property: {
          id: item.property.id,
          summaryLabel: propertySummary(item.property),
          address: item.property.address,
          city: item.property.city,
          state: item.property.state
        },
        requestedBy: {
          id: item.requestedBy.id,
          name: publicAccountDisplayName(item.requestedBy),
          email: item.requestedBy.email
        },
        lastReminderAt: reminderActivity?.createdAt || null,
        createdAt: item.createdAt
      };
    })
  };
}

export async function resendPendingRenterInvite(input: {
  adminUserId: string;
  proposedRenterId: string;
}) {
  const proposedRenter = await prisma.proposedRenter.findUnique({
    where: { id: input.proposedRenterId },
    include: {
      property: true,
      renterAccount: true
    }
  });

  if (!proposedRenter) {
    throw new AppError("Proposed renter not found", 404, "PROPOSED_RENTER_NOT_FOUND");
  }

  const inviteState = await notifyProposedRenter({
    requestedByAccountId: input.adminUserId,
    propertySummaryLabel: propertySummary(proposedRenter.property),
    renterEmail: proposedRenter.email,
    renterName: proposedRenter.organizationName || `${proposedRenter.firstName} ${proposedRenter.lastName}`.trim(),
    existingAccountId: proposedRenter.renterAccount?.status === "ACTIVE" ? proposedRenter.renterAccount.id : null
  });

  await prisma.proposedRenterActivity.create({
    data: {
      proposedRenterId: proposedRenter.id,
      actorAccountId: null,
      activityType: "COMMENT",
      message:
        inviteState.mode === "EXISTING_MEMBER"
          ? "Admin reminder sent to existing renter member."
          : "Admin reminder sent to invited renter to complete signup.",
      metadata: inviteState.invitePreviewUrl ? ({ invitePreviewUrl: inviteState.invitePreviewUrl } as Prisma.JsonObject) : undefined
    }
  });

  return {
    success: true,
    invitePreviewUrl: inviteState.invitePreviewUrl
  };
}

export async function decideWorkspaceProposedRenter(input: {
  publicAccountId: string;
  proposedRenterId: string;
  decision: ProposedRenterDecision;
  note?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const account = await getWorkspaceAccount(input.publicAccountId, tx);
    if (account.accountType !== "LANDLORD") {
      throw new AppError("Only landlord accounts can take approve, hold, or decline decisions", 403, "FORBIDDEN");
    }

    const proposedRenter = await getAccessibleProposedRenter(input.publicAccountId, input.proposedRenterId, tx);
    const nextStatus = input.decision === "HOLD" ? "UNDER_REVIEW" : "DECISION_READY";

    await tx.proposedRenter.update({
      where: { id: proposedRenter.id },
      data: {
        decision: input.decision,
        decisionAt: new Date(),
        decisionByAccountId: input.publicAccountId,
        decisionNote: input.note?.trim() || null,
        status: nextStatus
      } as any
    });

    await logProposedRenterActivity({
      proposedRenterId: proposedRenter.id,
      actorAccountId: input.publicAccountId,
      activityType: "DECISION",
      message: `Landlord decision recorded as ${input.decision.toLowerCase()}.`,
      metadata: input.note?.trim()
        ? ({ note: input.note.trim(), decision: input.decision } as Prisma.JsonObject)
        : ({ decision: input.decision } as Prisma.JsonObject),
      tx
    });

    return getWorkspaceQueueItem(input.publicAccountId, proposedRenter.id, tx);
  });
}

export async function requestWorkspaceRentScore(input: {
  publicAccountId: string;
  proposedRenterId: string;
  notes?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const proposedRenter = await getAccessibleProposedRenter(input.publicAccountId, input.proposedRenterId, tx);

    await tx.scoreRequest.create({
      data: {
        proposedRenterId: proposedRenter.id,
        requestedByAccountId: input.publicAccountId,
        notes: input.notes?.trim() || null,
        status: "REQUESTED"
      }
    });

    await logProposedRenterActivity({
      proposedRenterId: proposedRenter.id,
      actorAccountId: input.publicAccountId,
      activityType: "SCORE_REQUESTED",
      message: "Rent score review requested for this renter.",
      metadata: input.notes?.trim() ? ({ note: input.notes.trim() } as Prisma.JsonObject) : undefined,
      tx
    });

    await tx.proposedRenter.update({
      where: { id: proposedRenter.id },
      data: { status: "SCORE_REQUESTED" }
    });

    return getWorkspaceQueueItem(input.publicAccountId, proposedRenter.id, tx);
  });
}

export async function forwardWorkspaceScoreRequest(input: {
  publicAccountId: string;
  scoreRequestId: string;
  forwardToAccountId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const currentAccount = await getWorkspaceAccount(input.publicAccountId, tx);
    if (currentAccount.accountType !== "AGENT") {
      throw new AppError("Only agent accounts can forward rent score reports to landlord", 403, "FORBIDDEN");
    }

    const scoreRequest = await tx.scoreRequest.findFirst({
      where: {
        id: input.scoreRequestId,
        proposedRenter: {
          property: {
            members: {
              some: {
                publicAccountId: input.publicAccountId
              }
            }
          }
        }
      },
      include: {
        proposedRenter: {
          include: {
            property: {
              include: {
                members: {
                  include: {
                    account: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!scoreRequest) {
      throw new AppError("Score request not found", 404, "SCORE_REQUEST_NOT_FOUND");
    }

    const availableLandlords = scoreRequest.proposedRenter.property.members.filter(
      (member) => member.role === "LANDLORD" && member.publicAccountId !== input.publicAccountId
    );

    const landlord = input.forwardToAccountId
      ? availableLandlords.find((member) => member.publicAccountId === input.forwardToAccountId)
      : availableLandlords[0];

    if (!landlord) {
      throw new AppError("No linked landlord account was found for this property", 400, "LANDLORD_LINK_REQUIRED");
    }

    await tx.scoreRequest.update({
      where: { id: scoreRequest.id },
      data: {
        forwardedToAccountId: landlord.publicAccountId,
        forwardedAt: new Date(),
        status: "FORWARDED"
      }
    });

    await tx.proposedRenter.update({
      where: { id: scoreRequest.proposedRenter.id },
      data: { status: "SCORE_SHARED" }
    });

    await logProposedRenterActivity({
      proposedRenterId: scoreRequest.proposedRenter.id,
      actorAccountId: input.publicAccountId,
      activityType: "SCORE_FORWARDED",
      message: `Rent score report forwarded to ${publicAccountDisplayName(landlord.account)}.`,
      tx
    });

    return getWorkspaceQueueItem(input.publicAccountId, scoreRequest.proposedRenter.id, tx);
  });
}

export async function createWorkspacePaymentSchedule(input: {
  publicAccountId: string;
  proposedRenterId: string;
  paymentType: PaymentScheduleType;
  amountNgn: number;
  dueDate: Date;
  note?: string;
  recurrence?: {
    enabled?: boolean;
    frequency?: "MONTHLY" | "QUARTERLY" | "YEARLY";
    occurrences?: number;
  };
}) {
  return prisma.$transaction(async (tx) => {
    const proposedRenter = await getAccessibleProposedRenter(input.publicAccountId, input.proposedRenterId, tx);
    if (proposedRenter.decision !== "APPROVED") {
      throw new AppError("Payments can only be logged after the renter has been approved", 400, "RENTER_NOT_APPROVED");
    }

    const recurrenceEnabled = Boolean(input.recurrence?.enabled && input.recurrence?.frequency && input.recurrence?.occurrences);
    const recurrenceSuffix = recurrenceEnabled
      ? ` Recurs ${input.recurrence!.frequency!.toLowerCase()} for ${input.recurrence!.occurrences} future cycle${input.recurrence!.occurrences === 1 ? "" : "s"}.`
      : "";
    const scheduleNote = `${input.note?.trim() || ""}${recurrenceSuffix}`.trim() || null;

    const scheduleRows = [
      {
        proposedRenterId: proposedRenter.id,
        propertyId: proposedRenter.propertyId,
        createdByAccountId: input.publicAccountId,
        paymentType: input.paymentType,
        amountNgn: input.amountNgn,
        dueDate: input.dueDate,
        note: scheduleNote
      }
    ];

    if (recurrenceEnabled) {
      for (let step = 1; step <= (input.recurrence?.occurrences || 0); step += 1) {
        scheduleRows.push({
          proposedRenterId: proposedRenter.id,
          propertyId: proposedRenter.propertyId,
          createdByAccountId: input.publicAccountId,
          paymentType: input.paymentType,
          amountNgn: input.amountNgn,
          dueDate: addDateByFrequency(input.dueDate, input.recurrence!.frequency!, step),
          note: scheduleNote
        });
      }
    }

    await tx.paymentSchedule.createMany({
      data: scheduleRows
    });

    await logProposedRenterActivity({
      proposedRenterId: proposedRenter.id,
      actorAccountId: input.publicAccountId,
      activityType: "PAYMENT_SCHEDULE_CREATED",
      message: recurrenceEnabled
        ? `${input.paymentType.replaceAll("_", " ")} schedule logged from ${input.dueDate.toLocaleDateString()} with ${input.recurrence!.occurrences} future recurring cycle${input.recurrence!.occurrences === 1 ? "" : "s"}.`
        : `${input.paymentType.replaceAll("_", " ")} schedule logged for ${input.dueDate.toLocaleDateString()}.`,
      metadata: {
        amountNgn: input.amountNgn,
        paymentType: input.paymentType,
        recurrence: recurrenceEnabled
          ? {
              frequency: input.recurrence!.frequency,
              occurrences: input.recurrence!.occurrences
            }
          : null
      } as Prisma.JsonObject,
      tx
    });

    return getWorkspaceQueueItem(input.publicAccountId, proposedRenter.id, tx);
  });
}

export async function updateWorkspacePaymentSchedule(input: {
  publicAccountId: string;
  paymentScheduleId: string;
  status: PaymentScheduleStatus;
  paidAt?: Date | null;
}) {
  return prisma.$transaction(async (tx) => {
    await getWorkspaceAccount(input.publicAccountId, tx);
    const schedule = await tx.paymentSchedule.findFirst({
      where: {
        id: input.paymentScheduleId,
        property: {
          members: {
            some: {
              publicAccountId: input.publicAccountId
            }
          }
        }
      }
    });

    if (!schedule) {
      throw new AppError("Payment schedule not found", 404, "PAYMENT_SCHEDULE_NOT_FOUND");
    }

    await tx.paymentSchedule.update({
      where: { id: schedule.id },
      data: {
        status: input.status,
        paidAt: input.status === "PAID" ? input.paidAt ?? new Date() : null
      }
    });

    await logProposedRenterActivity({
      proposedRenterId: schedule.proposedRenterId,
      actorAccountId: input.publicAccountId,
      activityType: "PAYMENT_SCHEDULE_UPDATED",
      message: `Payment schedule marked as ${input.status.toLowerCase()}.`,
      metadata: {
        paymentScheduleId: schedule.id,
        status: input.status
      } as Prisma.JsonObject,
      tx
    });

    return getWorkspaceQueueItem(input.publicAccountId, schedule.proposedRenterId, tx);
  });
}

export async function commentOnWorkspaceProposedRenter(input: {
  publicAccountId: string;
  proposedRenterId: string;
  message: string;
}) {
  return prisma.$transaction(async (tx) => {
    const proposedRenter = await getAccessibleProposedRenter(input.publicAccountId, input.proposedRenterId, tx);
    await logProposedRenterActivity({
      proposedRenterId: proposedRenter.id,
      actorAccountId: input.publicAccountId,
      activityType: "COMMENT",
      message: input.message.trim(),
      tx
    });
    return getWorkspaceQueueItem(input.publicAccountId, proposedRenter.id, tx);
  });
}
