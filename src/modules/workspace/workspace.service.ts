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
import { buildRentScoreSnapshot, recordRentScoreEvent } from "../rent-score/rent-score.service";
import { attachPassportPhotoToPublicAccount, buildPublicDocumentViewUrl, toPublicDocumentAsset } from "../storage/storage.service";
import { renderTransactionalEmail } from "../mail/mail-templates";
import { sendTransactionalMail } from "../mail/mail.service";
import { getAvailableRentScorePaymentProviders } from "../score-payments/score-payments.service";

type DbClient = Prisma.TransactionClient | typeof prisma;
type ProposedRenterDecision = "APPROVED" | "HOLD" | "DECLINED";
type PaymentTiming = "ON_TIME" | "LATE";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeOptionalEmail(email?: string | null) {
  const value = email?.trim();
  return value ? value.toLowerCase() : null;
}

function publicAccountDisplayName(account: Pick<PublicAccount, "firstName" | "lastName" | "organizationName">) {
  if (account.organizationName?.trim()) return account.organizationName.trim();
  return [account.firstName, account.lastName].filter(Boolean).join(" ") || "Unnamed account";
}

function propertySummary(property: {
  name: string;
  propertyType?: string | null;
  bedroomCount?: number | null;
  unitCount?: number | null;
}) {
  const typeLabel = property.propertyType === "Flats" ? "Flat" : property.propertyType || "Property";
  if ((property.unitCount || 1) > 1) {
    return `${property.unitCount} Unit ${typeLabel} at ${property.name}`;
  }
  const bedroomLabel = `${property.bedroomCount || 1} Bedroom`;
  return `${bedroomLabel} ${typeLabel} at ${property.name}`;
}

function propertyUnitSummary(unit?: {
  label?: string | null;
  bedroomCount?: number | null;
  bathroomCount?: number | null;
} | null) {
  if (!unit) return null;
  const parts = [
    unit.label?.trim() || null,
    unit.bedroomCount ? `${unit.bedroomCount} bed` : null,
    unit.bathroomCount ? `${unit.bathroomCount} bath` : null
  ].filter(Boolean);
  return parts.join(" · ");
}

function normalizeComparableValue(value?: string | null) {
  return value?.trim().toLowerCase() || "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inferLegacyPropertyUnit(proposedRenter: {
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
  email?: string | null;
  phone?: string | null;
  propertyUnit?: any;
  property?: {
    units?: Array<{
      id: string;
      label: string;
      address: string;
      city: string;
      state: string;
      bedroomCount: number;
      bathroomCount: number;
      isOccupied: boolean;
      currentTenantName?: string | null;
      currentTenantEmail?: string | null;
      currentTenantPhone?: string | null;
    }>;
  } | null;
}) {
  if (proposedRenter.propertyUnit) return proposedRenter.propertyUnit;

  const units = proposedRenter.property?.units || [];
  if (!units.length) return null;
  if (units.length === 1) return units[0];

  const renterEmail = normalizeComparableValue(proposedRenter.email);
  const renterPhone = normalizeComparableValue(proposedRenter.phone);
  const renterName = normalizeComparableValue(
    proposedRenter.organizationName || [proposedRenter.firstName, proposedRenter.lastName].filter(Boolean).join(" ")
  );

  const exactMatch = units.find((unit) => {
    const unitEmail = normalizeComparableValue(unit.currentTenantEmail);
    const unitPhone = normalizeComparableValue(unit.currentTenantPhone);
    const unitName = normalizeComparableValue(unit.currentTenantName);
    return (renterEmail && unitEmail === renterEmail) || (renterPhone && unitPhone === renterPhone) || (renterName && unitName === renterName);
  });

  if (exactMatch) return exactMatch;

  const occupiedUnits = units.filter((unit) => unit.isOccupied);
  if (occupiedUnits.length === 1) return occupiedUnits[0];

  return null;
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

function resolvePaymentTiming(dueDate: Date, paidAt: Date): PaymentTiming {
  return paidAt.getTime() <= dueDate.getTime() ? "ON_TIME" : "LATE";
}

function buildRenterInviteUrl(email: string) {
  const base = env.APP_WEB_BASE_URL.replace(/\/+$/, "");
  return `${base}/signup?track=RENTER&email=${encodeURIComponent(email)}`;
}

function buildAppUrl(path: string) {
  const base = env.APP_WEB_BASE_URL.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function formatPropertyAddress(input: { address?: string | null; city?: string | null; state?: string | null }) {
  return [input.address, input.city, input.state].filter(Boolean).join(", ");
}

async function notifyRenterOfDecision(input: {
  decision: ProposedRenterDecision;
  renterEmail: string;
  renterName: string;
  propertyAddress: string;
  note?: string | null;
}) {
  const greetingName = input.renterName || "there";
  const openAccountUrl = buildAppUrl("/account/renter/queue");
  const trimmedNote = input.note?.trim() || null;
  const safeNote = trimmedNote ? escapeHtml(trimmedNote) : null;

  const decisionCopy =
    input.decision === "APPROVED"
      ? {
          subject: "Congratulations on Your Rental Application!",
          eyebrow: "Application Approved",
          title: "Your rental application has been approved",
          paragraphs: [
            `We are pleased to inform you that your rental application for <strong>${input.propertyAddress}</strong> has been approved. Congratulations and welcome to your new home.`,
            "Please log on to your RentSure account and confirm that you want to proceed with signing the lease agreement.",
            "If you have any questions or need further information, feel free to reach out."
          ]
        }
      : input.decision === "HOLD"
        ? {
            subject: "Additional Information Needed for Your Rental Application",
            eyebrow: "More Information Requested",
            title: "The landlord needs a bit more information",
            paragraphs: [
              `Your rental application for <strong>${input.propertyAddress}</strong> is still under review.`,
              "The landlord has requested additional information before making a final decision. Please sign in to your RentSure account and review your application details.",
              safeNote
                ? `Additional note from the landlord: <strong>${safeNote}</strong>`
                : "If you have any extra supporting details to provide, this is the right time to update them."
            ]
          }
        : {
            subject: "Update on Your Rental Application",
            eyebrow: "Application Update",
            title: "Your rental application was not approved",
            paragraphs: [
              `Thank you for your interest in the property at <strong>${input.propertyAddress}</strong>.`,
              "We’re sorry to let you know that your rental application was not approved at this time.",
              safeNote
                ? `Landlord note: <strong>${safeNote}</strong>`
                : "You can still continue improving your profile and rent score in RentSure for future property applications."
            ]
          };

  return sendTransactionalMail({
    category: "RENTER_DECISION",
    to: input.renterEmail,
    subject: decisionCopy.subject,
    html: renderTransactionalEmail({
      eyebrow: decisionCopy.eyebrow,
      title: decisionCopy.title,
      greeting: `Dear ${greetingName},`,
      paragraphs: decisionCopy.paragraphs,
      ctaLabel: "Open RentSure account",
      ctaUrl: openAccountUrl
    })
  });
}

function isMissingProposedRenterPropertyUnitColumn(error: unknown) {
  const meta =
    typeof error === "object" &&
    error !== null &&
    "meta" in error &&
    typeof (error as { meta?: unknown }).meta === "object" &&
    (error as { meta?: unknown }).meta !== null
      ? ((error as { meta: Record<string, unknown> }).meta as Record<string, unknown>)
      : null;
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : null;
  const column = typeof meta?.column === "string" ? meta.column : null;
  const rawCode = typeof meta?.code === "string" ? meta.code : null;
  const rawMessage = typeof meta?.message === "string" ? meta.message : null;

  return (
    (code === "P2022" && column === "ProposedRenter.propertyUnitId") ||
    (code === "P2010" &&
      rawCode === "42703" &&
      typeof rawMessage === "string" &&
      rawMessage.includes('column "propertyUnitId" does not exist'))
  );
}

let proposedRenterPropertyUnitColumnSupported: boolean | null = null;
let proposedRenterPropertyUnitColumnProbe: Promise<boolean> | null = null;

async function supportsProposedRenterPropertyUnitColumn() {
  if (proposedRenterPropertyUnitColumnSupported !== null) {
    return proposedRenterPropertyUnitColumnSupported;
  }

  if (!proposedRenterPropertyUnitColumnProbe) {
    proposedRenterPropertyUnitColumnProbe = prisma.$queryRawUnsafe<Array<{ propertyUnitId: string | null }>>(
      'SELECT "propertyUnitId" FROM "ProposedRenter" LIMIT 1'
    )
      .then(() => {
        proposedRenterPropertyUnitColumnSupported = true;
        return true;
      })
      .catch((error: unknown) => {
        if (isMissingProposedRenterPropertyUnitColumn(error)) {
          proposedRenterPropertyUnitColumnSupported = false;
          return false;
        }
        throw error;
      })
      .finally(() => {
        proposedRenterPropertyUnitColumnProbe = null;
      });
  }

  return proposedRenterPropertyUnitColumnProbe;
}

function markProposedRenterPropertyUnitColumnUnsupported() {
  proposedRenterPropertyUnitColumnSupported = false;
  proposedRenterPropertyUnitColumnProbe = null;
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

async function listLinkedWorkspaceAccounts(publicAccountId: string, tx: DbClient = prisma) {
  const memberships = await tx.propertyMember.findMany({
    where: { publicAccountId },
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

  const linkedById = new Map<string, {
    accountId: string;
    accountType: "LANDLORD" | "AGENT";
    name: string;
    email: string;
    phone: string;
    propertyCount: number;
    properties: string[];
  }>();

  for (const membership of memberships) {
    for (const member of membership.property.members) {
      if (member.publicAccountId === publicAccountId) continue;
      if (member.account.accountType !== "LANDLORD" && member.account.accountType !== "AGENT") continue;

      const existing = linkedById.get(member.account.id);
      if (existing) {
        if (!existing.properties.includes(membership.property.name)) {
          existing.properties.push(membership.property.name);
          existing.propertyCount += 1;
        }
        continue;
      }

      linkedById.set(member.account.id, {
        accountId: member.account.id,
        accountType: member.account.accountType,
        name: publicAccountDisplayName(member.account),
        email: member.account.email,
        phone: member.account.phone,
        propertyCount: 1,
        properties: [membership.property.name]
      });
    }
  }

  return Array.from(linkedById.values()).sort((left, right) => left.name.localeCompare(right.name));
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
          },
          units: {
            orderBy: { createdAt: "asc" }
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
  let supportsPropertyUnitColumn = await supportsProposedRenterPropertyUnitColumn();

  const loadRenter = (usePropertyUnitColumn: boolean) =>
    usePropertyUnitColumn
      ? tx.proposedRenter.findFirst({
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
            propertyUnit: true,
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
          }
        } as any)
      : tx.proposedRenter.findFirst({
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
          select: {
            id: true,
            propertyId: true,
            renterAccountId: true,
            requestedByAccountId: true,
            firstName: true,
            lastName: true,
            organizationName: true,
            email: true,
            phone: true,
            address: true,
            state: true,
            city: true,
            status: true,
            decision: true,
            decisionAt: true,
            decisionByAccountId: true,
            decisionNote: true,
            notes: true,
            createdAt: true,
            updatedAt: true,
            decisionBy: true,
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
          }
        });

  let renter;
  try {
    renter = await loadRenter(supportsPropertyUnitColumn);
  } catch (error: unknown) {
    if (!supportsPropertyUnitColumn || !isMissingProposedRenterPropertyUnitColumn(error)) {
      throw error;
    }
    markProposedRenterPropertyUnitColumnUnsupported();
    supportsPropertyUnitColumn = false;
    renter = await loadRenter(false);
  }

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
    | "PAYMENT_CONFIRMATION_INITIATED"
    | "PAYMENT_CONFIRMED"
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

async function createPublicAccountNotification(input: {
  publicAccountId: string;
  notificationType: "PROPERTY_LINKED";
  title: string;
  message: string;
  ctaLabel?: string;
  ctaPath?: string;
  metadata?: Prisma.JsonObject;
  tx?: DbClient;
}) {
  const client = input.tx ?? prisma;
  await client.publicAccountNotification.create({
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

async function notifyProposedRenter(input: {
  requestedByAccountId: string;
  requestedByName: string;
  requestedByAccountType?: "LANDLORD" | "AGENT" | "ADMIN" | null;
  propertySummaryLabel: string;
  propertyAddress: string;
  renterEmail: string;
  renterName: string;
  existingAccountId?: string | null;
  tx?: DbClient;
}) {
  const isExistingMember = Boolean(input.existingAccountId);
  const actionPath = isExistingMember ? "/account/renter/queue" : `/signup?track=RENTER&email=${encodeURIComponent(input.renterEmail)}`;
  const actionUrl = buildAppUrl(actionPath);
  const linkedByAgent = input.requestedByAccountType === "AGENT";
  const greetingName = input.renterName || "there";
  const existingMemberSubject = "You've Been Linked to a Property!";
  const inviteSubject = "Reminder: Complete Your Account Setup!";
  const existingMemberIntro = linkedByAgent
    ? `You have been successfully linked to a property at <strong>${input.propertyAddress}</strong> by <strong>${input.requestedByName}</strong>, the agent representing the landlord.`
    : `You have been successfully linked to a property at <strong>${input.propertyAddress}</strong> by the landlord.`;
  const existingMemberFollowUp = linkedByAgent
    ? "Please note that you will be informed if the landlord makes any decisions about your application."
    : "Should the landlord make any decisions regarding your application, you will be notified promptly.";
  const signInCopy = "Sign in to your RentSure account to review the linked property and landlord details.";
  const delivery = await sendTransactionalMail({
    category: isExistingMember ? "RENTER_NOTIFICATION" : "RENTER_INVITE",
    to: input.renterEmail,
    subject: isExistingMember ? existingMemberSubject : inviteSubject,
    html: renderTransactionalEmail({
      eyebrow: isExistingMember ? "Property Linked" : "Account Setup",
      title: isExistingMember ? "You've been linked to a property" : "Complete your account setup",
      greeting: `Dear ${greetingName},`,
      paragraphs: isExistingMember
        ? [existingMemberIntro, existingMemberFollowUp, signInCopy]
        : [
            `We noticed that you were recently linked to a property at <strong>${input.propertyAddress}</strong>, but it looks like you haven’t created your account yet.`,
            "Completing your account setup will allow you to stay updated on your application status and receive important notifications from the landlord or agent.",
            "Sign up to get started and let us know if you need assistance or have any questions, please don’t hesitate to reach out."
          ],
      ctaLabel: isExistingMember ? "Sign In / Open account" : "Sign Up",
      ctaUrl: actionUrl
    })
  });

  if (input.existingAccountId) {
    await createPublicAccountNotification({
      publicAccountId: input.existingAccountId,
      notificationType: "PROPERTY_LINKED",
      title: linkedByAgent ? "Renter Linked by Agent" : "Renter Linked by Landlord",
      message: linkedByAgent
        ? `${input.requestedByName} linked you to ${input.propertyAddress}. You will be informed when the landlord makes a decision.`
        : `You have been linked to ${input.propertyAddress}. You will be notified when the landlord makes a decision.`,
      ctaLabel: "Open account",
      ctaPath: "/account/renter/queue",
      metadata: {
        propertySummaryLabel: input.propertySummaryLabel,
        propertyAddress: input.propertyAddress,
        requestedByName: input.requestedByName
      },
      tx: input.tx
    });

    logger.info(
      {
        event: "workspace.renter_notification",
        renterAccountId: input.existingAccountId,
        renterEmail: input.renterEmail,
        requestedByAccountId: input.requestedByAccountId,
        property: input.propertySummaryLabel,
        previewUrl: delivery.previewUrl || null,
        deliveryMode: delivery.deliveryMode
      },
      "Existing renter linked to proposed renter case"
    );
    return {
      mode: "EXISTING_MEMBER" as const,
      invitePreviewUrl: delivery.previewUrl || undefined
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
      previewUrl: delivery.previewUrl || null,
      deliveryMode: delivery.deliveryMode
    },
    "Proposed renter invite generated"
  );

  return {
    mode: "NEW_INVITE" as const,
    invitePreviewUrl: delivery.previewUrl || undefined
  };
}

function canUseExistingRenterAccount(account?: PublicAccount | null) {
  return Boolean(account && account.accountType === "RENTER" && account.status !== "DISABLED");
}

export async function getWorkspaceOverview(publicAccountId: string) {
  const account = await getWorkspaceAccount(publicAccountId);
  const canViewRentScore = account.accountType === "LANDLORD";

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
      select: {
        id: true,
        organizationName: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        renterAccountId: true,
        createdAt: true,
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
      linkedRentScore: canViewRentScore ? await mapLinkedRentScore(item.renterAccountId) : null,
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

  const linkedAccounts = await listLinkedWorkspaceAccounts(publicAccountId);

  return {
    ...toWorkspaceProfilePayload(account),
    linkedAccounts
  };
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
          _count: {
            select: {
              proposedRenters: true
            }
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
      isOccupied: entry.property.isOccupied,
      currentTenantName: entry.property.currentTenantName,
      currentTenantEmail: entry.property.currentTenantEmail,
      currentTenantPhone: entry.property.currentTenantPhone,
      membershipRole: entry.role,
      createdAt: entry.property.createdAt,
      members: entry.property.members.map(memberSummary),
      proposedRenterCount: entry.property._count.proposedRenters,
      units: entry.property.units.map((unit) => ({
        id: unit.id,
        label: unit.label,
        address: unit.address,
        city: unit.city,
        state: unit.state,
        bedroomCount: unit.bedroomCount,
        bathroomCount: unit.bathroomCount,
        isOccupied: unit.isOccupied,
        currentTenantName: unit.currentTenantName,
        currentTenantEmail: unit.currentTenantEmail,
        currentTenantPhone: unit.currentTenantPhone
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
  address: string;
  state: string;
  city: string;
  units: Array<{
    label: string;
    bedroomCount: number;
    bathroomCount: number;
    isOccupied: boolean;
    currentTenantName?: string;
    currentTenantEmail?: string;
    currentTenantPhone?: string;
  }>;
}) {
  return prisma.$transaction(async (tx) => {
    const account = await getWorkspaceAccount(input.publicAccountId, tx);
    if (account.accountType !== "LANDLORD") {
      throw new AppError("Only landlord accounts can add properties", 403, "FORBIDDEN");
    }
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

    const propertyAddress = input.address.trim();
    const propertyState = input.state.trim();
    const propertyCity = input.city.trim();
    const normalizedUnits = input.units.map((unit, index) => ({
      label: unit.label.trim() || `Unit ${index + 1}`,
      bedroomCount: unit.bedroomCount,
      bathroomCount: unit.bathroomCount,
      isOccupied: unit.isOccupied,
      currentTenantName: unit.isOccupied ? unit.currentTenantName?.trim() || null : null,
      currentTenantEmail: unit.isOccupied ? normalizeOptionalEmail(unit.currentTenantEmail) : null,
      currentTenantPhone: unit.isOccupied ? unit.currentTenantPhone?.trim() || null : null
    }));
    const occupiedUnits = normalizedUnits.filter((unit) => unit.isOccupied);
    const primaryUnit = normalizedUnits[0];

    const property = await tx.property.create({
      data: {
        name: input.name.trim(),
        ownerName: input.ownerName.trim(),
        landlordEmail: normalizedLandlordEmail,
        address: propertyAddress,
        state: propertyState,
        city: propertyCity,
        propertyType: input.propertyType.trim(),
        bedroomCount: primaryUnit?.bedroomCount ?? input.bedroomCount,
        bathroomCount: primaryUnit?.bathroomCount ?? input.bathroomCount,
        toiletCount: primaryUnit?.bathroomCount ?? input.bathroomCount,
        unitCount: normalizedUnits.length,
        isOccupied: occupiedUnits.length > 0,
        currentTenantName: occupiedUnits.length === 1 ? occupiedUnits[0]?.currentTenantName ?? null : null,
        currentTenantEmail: occupiedUnits.length === 1 ? occupiedUnits[0]?.currentTenantEmail ?? null : null,
        currentTenantPhone: occupiedUnits.length === 1 ? occupiedUnits[0]?.currentTenantPhone ?? null : null,
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

    await tx.propertyUnit.createMany({
      data: normalizedUnits.map((unit) => ({
        propertyId: property.id,
        label: unit.label,
        address: propertyAddress,
        state: propertyState,
        city: propertyCity,
        bedroomCount: unit.bedroomCount,
        bathroomCount: unit.bathroomCount,
        isOccupied: unit.isOccupied,
        currentTenantName: unit.currentTenantName,
        currentTenantEmail: unit.currentTenantEmail,
        currentTenantPhone: unit.currentTenantPhone
      }))
    });

    return getWorkspaceOverview(input.publicAccountId);
  });
}

export async function updateWorkspaceProperty(input: {
  publicAccountId: string;
  propertyId: string;
  name: string;
  ownerName: string;
  landlordEmail: string;
  propertyType: string;
  bedroomCount: number;
  bathroomCount: number;
  address: string;
  state: string;
  city: string;
  units: Array<{
    label: string;
    bedroomCount: number;
    bathroomCount: number;
    isOccupied: boolean;
    currentTenantName?: string;
    currentTenantEmail?: string;
    currentTenantPhone?: string;
  }>;
}) {
  return prisma.$transaction(async (tx) => {
    const account = await getWorkspaceAccount(input.publicAccountId, tx);
    if (account.accountType !== "LANDLORD") {
      throw new AppError("Only landlord accounts can edit properties", 403, "FORBIDDEN");
    }
    const membership = await getPropertyMembership(input.publicAccountId, input.propertyId, tx);
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

    const propertyAddress = input.address.trim();
    const propertyState = input.state.trim();
    const propertyCity = input.city.trim();
    const normalizedUnits = input.units.map((unit, index) => ({
      label: unit.label.trim() || `Unit ${index + 1}`,
      bedroomCount: unit.bedroomCount,
      bathroomCount: unit.bathroomCount,
      isOccupied: unit.isOccupied,
      currentTenantName: unit.isOccupied ? unit.currentTenantName?.trim() || null : null,
      currentTenantEmail: unit.isOccupied ? normalizeOptionalEmail(unit.currentTenantEmail) : null,
      currentTenantPhone: unit.isOccupied ? unit.currentTenantPhone?.trim() || null : null
    }));
    const occupiedUnits = normalizedUnits.filter((unit) => unit.isOccupied);
    const primaryUnit = normalizedUnits[0];

    await tx.property.update({
      where: { id: membership.propertyId },
      data: {
        name: input.name.trim(),
        ownerName: input.ownerName.trim(),
        landlordEmail: normalizedLandlordEmail,
        address: propertyAddress,
        state: propertyState,
        city: propertyCity,
        propertyType: input.propertyType.trim(),
        bedroomCount: primaryUnit?.bedroomCount ?? input.bedroomCount,
        bathroomCount: primaryUnit?.bathroomCount ?? input.bathroomCount,
        toiletCount: primaryUnit?.bathroomCount ?? input.bathroomCount,
        unitCount: normalizedUnits.length,
        isOccupied: occupiedUnits.length > 0,
        currentTenantName: occupiedUnits.length === 1 ? occupiedUnits[0]?.currentTenantName ?? null : null,
        currentTenantEmail: occupiedUnits.length === 1 ? occupiedUnits[0]?.currentTenantEmail ?? null : null,
        currentTenantPhone: occupiedUnits.length === 1 ? occupiedUnits[0]?.currentTenantPhone ?? null : null,
        createdByAccountId: input.publicAccountId
      }
    });

    await tx.propertyMember.upsert({
      where: {
        propertyId_publicAccountId_role: {
          propertyId: membership.propertyId,
          publicAccountId: landlordAccount.id,
          role: "LANDLORD"
        }
      },
      update: {
        isPrimary: true
      },
      create: {
        propertyId: membership.propertyId,
        publicAccountId: landlordAccount.id,
        role: "LANDLORD",
        isPrimary: true
      }
    });

    await tx.propertyUnit.deleteMany({
      where: { propertyId: membership.propertyId }
    });

    await tx.propertyUnit.createMany({
      data: normalizedUnits.map((unit) => ({
        propertyId: membership.propertyId,
        label: unit.label,
        address: propertyAddress,
        state: propertyState,
        city: propertyCity,
        bedroomCount: unit.bedroomCount,
        bathroomCount: unit.bathroomCount,
        isOccupied: unit.isOccupied,
        currentTenantName: unit.currentTenantName,
        currentTenantEmail: unit.currentTenantEmail,
        currentTenantPhone: unit.currentTenantPhone
      }))
    });

    return listWorkspaceProperties(input.publicAccountId);
  });
}

export async function shareWorkspaceProperty(input: {
  publicAccountId: string;
  propertyId: string;
  sharedWithEmail: string;
}) {
  return prisma.$transaction(async (tx) => {
    const currentAccount = await getWorkspaceAccount(input.publicAccountId, tx);
    if (currentAccount.accountType !== "LANDLORD") {
      throw new AppError("Only landlord accounts can link agents to properties", 403, "FORBIDDEN");
    }
    const membership = await getPropertyMembership(input.publicAccountId, input.propertyId, tx);
    const partner = await tx.publicAccount.findUnique({
      where: { email: normalizeEmail(input.sharedWithEmail) }
    });

    if (!partner || partner.status !== "ACTIVE") {
      throw new AppError("Shared account was not found or is not active", 404, "SHARED_ACCOUNT_NOT_FOUND");
    }

    const expectedType: PublicAccountType = "AGENT";
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

export async function searchWorkspaceAgents(input: {
  publicAccountId: string;
  q: string;
}) {
  const currentAccount = await getWorkspaceAccount(input.publicAccountId);
  if (currentAccount.accountType !== "LANDLORD") {
    throw new AppError("Only landlord accounts can search for agents", 403, "FORBIDDEN");
  }

  const query = input.q.trim();
  if (query.length < 2) {
    return { items: [] };
  }

  const accounts = await prisma.publicAccount.findMany({
    where: {
      accountType: "AGENT",
      status: "ACTIVE",
      OR: [
        { email: { contains: query, mode: "insensitive" } },
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
        { organizationName: { contains: query, mode: "insensitive" } }
      ]
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 8
  });

  return {
    items: accounts.map((account) => ({
      id: account.id,
      name: publicAccountDisplayName(account),
      email: account.email
    }))
  };
}

export async function listWorkspaceQueue(publicAccountId: string) {
  const account = await getWorkspaceAccount(publicAccountId);
  const canViewRentScore = account.accountType === "LANDLORD";

  const items: any[] = await prisma.proposedRenter
    .findMany({
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
        propertyUnit: true,
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
        },
        scoreRequests: {
          include: {
            requestedBy: true,
            forwardedTo: true
          },
          orderBy: { createdAt: "desc" }
        },
        rentScorePayments: {
          orderBy: { createdAt: "desc" },
          take: 1
        },
        paymentSchedules: {
          orderBy: { dueDate: "asc" },
          take: 4
        }
      },
      orderBy: { createdAt: "desc" }
    } as any)
    .catch((error: unknown) => {
      if (isMissingProposedRenterPropertyUnitColumn(error)) {
        return prisma.proposedRenter.findMany({
          where: {
            property: {
              members: {
                some: {
                  publicAccountId
                }
              }
            }
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organizationName: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            status: true,
            createdAt: true,
            decisionBy: true,
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
            },
            scoreRequests: {
              include: {
                requestedBy: true,
                forwardedTo: true
              },
              orderBy: { createdAt: "desc" }
            },
            rentScorePayments: {
              orderBy: { createdAt: "desc" },
              take: 1
            },
            paymentSchedules: {
              orderBy: { dueDate: "asc" },
              take: 4
            }
          },
          orderBy: { createdAt: "desc" }
        });
      }
      throw error;
    });

  return {
    items: await Promise.all(
    items.map(async (item) => {
        const resolvedPropertyUnit = inferLegacyPropertyUnit(item);
        const latestScoreRequest = item.scoreRequests[0] || null;
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
          propertyUnit: item.propertyUnit
            ? {
                id: item.propertyUnit.id,
                label: item.propertyUnit.label,
                summaryLabel: propertyUnitSummary(item.propertyUnit),
                address: item.propertyUnit.address,
                city: item.propertyUnit.city,
                state: item.propertyUnit.state,
                bedroomCount: item.propertyUnit.bedroomCount,
                bathroomCount: item.propertyUnit.bathroomCount
              }
            : null,
          linkedRentScore: canViewRentScore ? await mapLinkedRentScore(item.renterAccountId) : null,
          decision: item.decision
            ? {
                decision: item.decision,
                decidedAt: item.decisionAt,
                decidedByName: item.decisionBy ? publicAccountDisplayName(item.decisionBy) : null,
                note: item.decisionNote
              }
            : null,
          latestScoreRequest: latestScoreRequest
            ? {
                id: latestScoreRequest.id,
                status: latestScoreRequest.status,
                notes: latestScoreRequest.notes,
                createdAt: latestScoreRequest.createdAt,
                reviewedAt: latestScoreRequest.reviewedAt,
                requestedBy: publicAccountDisplayName(latestScoreRequest.requestedBy),
                forwardedTo: latestScoreRequest.forwardedTo ? publicAccountDisplayName(latestScoreRequest.forwardedTo) : null
              }
            : null,
          latestRentScorePayment: item.rentScorePayments[0]
            ? {
                id: item.rentScorePayments[0].id,
                provider: item.rentScorePayments[0].provider,
                status: item.rentScorePayments[0].status,
              amountNgn: item.rentScorePayments[0].amountNgn,
              reference: item.rentScorePayments[0].reference,
              reportApprovedAt: item.rentScorePayments[0].reportApprovedAt,
              createdAt: item.rentScorePayments[0].createdAt
            }
            : null,
          paymentSchedules: item.paymentSchedules.map((schedule: any) => ({
            id: schedule.id,
            paymentType: schedule.paymentType,
            amountNgn: schedule.amountNgn,
            dueDate: schedule.dueDate,
            status: schedule.status,
            confirmationInitiatedAt: schedule.confirmationInitiatedAt,
            confirmedAt: schedule.confirmedAt,
            confirmationTiming: schedule.confirmationTiming
          })),
          createdAt: item.createdAt
        };
      })
    )
  };
}

export async function searchWorkspaceRenters(input: {
  publicAccountId: string;
  propertyId: string;
  propertyUnitId: string;
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
    prisma.proposedRenter
      .findMany({
        where: {
          propertyUnitId: input.propertyUnitId,
          decision: null
        },
        select: {
          renterAccountId: true,
          email: true
        }
      })
      .catch((error: unknown) => {
        if (isMissingProposedRenterPropertyUnitColumn(error)) {
          return prisma.proposedRenter.findMany({
            where: {
              propertyId: input.propertyId,
              decision: null
            },
            select: {
              renterAccountId: true,
              email: true
            }
          });
        }
        throw error;
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
  const account = await getWorkspaceAccount(publicAccountId, tx);
  const item = await getAccessibleProposedRenter(publicAccountId, proposedRenterId, tx);

  const [scoreRequests, paymentSchedules, latestRentScorePayment] = await Promise.all([
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
        createdBy: true,
        confirmationInitiatedBy: true,
        confirmedBy: true
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }]
    }),
    tx.rentScorePayment.findFirst({
      where: { proposedRenterId },
      orderBy: { createdAt: "desc" }
    })
  ]);

  const latestScoreRequest = scoreRequests[0] || null;
  const resolvedPropertyUnit = inferLegacyPropertyUnit(item);
  const canViewRentScore = account.accountType === "LANDLORD";
  const [linkedRentScore, linkedRentScoreReport] = await Promise.all([
    canViewRentScore ? mapLinkedRentScore(item.renterAccountId) : Promise.resolve(null),
    canViewRentScore ? getLinkedRentScoreReport(item.renterAccountId) : Promise.resolve(null)
  ]);
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
      members: item.property.members.map(memberSummary),
      units: (item.property.units || []).map((unit: any) => ({
        id: unit.id,
        label: unit.label,
        address: unit.address,
        city: unit.city,
        state: unit.state,
        bedroomCount: unit.bedroomCount,
        bathroomCount: unit.bathroomCount,
        isOccupied: unit.isOccupied,
        currentTenantName: unit.currentTenantName,
        currentTenantEmail: unit.currentTenantEmail,
        currentTenantPhone: unit.currentTenantPhone
      }))
    },
          propertyUnit: resolvedPropertyUnit
            ? {
                id: resolvedPropertyUnit.id,
                label: resolvedPropertyUnit.label,
                summaryLabel: propertyUnitSummary(resolvedPropertyUnit),
                address: resolvedPropertyUnit.address,
                city: resolvedPropertyUnit.city,
                state: resolvedPropertyUnit.state,
                bedroomCount: resolvedPropertyUnit.bedroomCount,
                bathroomCount: resolvedPropertyUnit.bathroomCount,
                isOccupied: resolvedPropertyUnit.isOccupied,
                currentTenantName: resolvedPropertyUnit.currentTenantName,
                currentTenantEmail: resolvedPropertyUnit.currentTenantEmail,
                currentTenantPhone: resolvedPropertyUnit.currentTenantPhone
              }
            : null,
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
    latestRentScorePayment: latestRentScorePayment
      ? {
          id: latestRentScorePayment.id,
          provider: latestRentScorePayment.provider,
          status: latestRentScorePayment.status,
          amountNgn: latestRentScorePayment.amountNgn,
          currency: latestRentScorePayment.currency,
          reference: latestRentScorePayment.reference,
          checkoutUrl: latestRentScorePayment.checkoutUrl,
          manualTransferReference: latestRentScorePayment.manualTransferReference,
          notes: latestRentScorePayment.notes,
          reportApprovedAt: latestRentScorePayment.reportApprovedAt,
          createdAt: latestRentScorePayment.createdAt,
          manualTransfer:
            latestRentScorePayment.provider === "MANUAL_TRANSFER" && latestRentScorePayment.metadata && typeof latestRentScorePayment.metadata === "object"
              ? latestRentScorePayment.metadata
              : null
        }
      : null,
    availableRentScorePaymentProviders: getAvailableRentScorePaymentProviders(),
    paymentSchedules: paymentSchedules.map((schedule) => ({
      id: schedule.id,
      paymentType: schedule.paymentType,
      amountNgn: schedule.amountNgn,
      dueDate: schedule.dueDate,
      status: schedule.status,
      note: schedule.note,
      paidAt: schedule.paidAt,
      confirmationNote: schedule.confirmationNote,
      receiptReference: schedule.receiptReference,
      paymentEvidenceObjectKey: schedule.paymentEvidenceObjectKey,
      paymentEvidenceFileName: schedule.paymentEvidenceFileName,
      paymentEvidenceMimeType: schedule.paymentEvidenceMimeType,
      paymentEvidenceFileSize: schedule.paymentEvidenceFileSize,
      paymentEvidenceUploadedAt: schedule.paymentEvidenceUploadedAt,
      paymentEvidenceViewUrl: schedule.paymentEvidenceObjectKey ? buildPublicDocumentViewUrl(schedule.paymentEvidenceObjectKey) : null,
      confirmationInitiatedAt: schedule.confirmationInitiatedAt,
      confirmationInitiatedBy: schedule.confirmationInitiatedBy
        ? {
            id: schedule.confirmationInitiatedBy.id,
            name: publicAccountDisplayName(schedule.confirmationInitiatedBy),
            email: schedule.confirmationInitiatedBy.email,
            accountType: schedule.confirmationInitiatedBy.accountType
          }
        : null,
      confirmedAt: schedule.confirmedAt,
      confirmedBy: schedule.confirmedBy
        ? {
            id: schedule.confirmedBy.id,
            name: publicAccountDisplayName(schedule.confirmedBy),
            email: schedule.confirmedBy.email,
            accountType: schedule.confirmedBy.accountType
          }
        : null,
      confirmationTiming: schedule.confirmationTiming,
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

export async function listAdminRenterActivities() {
  const items = await prisma.proposedRenterActivity.findMany({
    where: {
      actor: {
        accountType: "RENTER"
      }
    },
    include: {
      actor: true,
      proposedRenter: {
        select: {
          id: true,
          renterAccountId: true,
          firstName: true,
          lastName: true,
          organizationName: true,
          email: true,
          status: true,
          decision: true,
          property: true,
          renterAccount: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  return {
    items: items.map((item) => ({
      id: item.id,
      activityType: item.activityType,
      message: item.message,
      createdAt: item.createdAt,
      actor: item.actor
        ? {
            id: item.actor.id,
            name: publicAccountDisplayName(item.actor),
            email: item.actor.email
          }
        : null,
      renter: {
        proposedRenterId: item.proposedRenter.id,
        accountId: item.proposedRenter.renterAccountId,
        name: item.proposedRenter.organizationName || `${item.proposedRenter.firstName} ${item.proposedRenter.lastName}`.trim(),
        email: item.proposedRenter.email,
        status: item.proposedRenter.status,
        decision: item.proposedRenter.decision
      },
      property: {
        id: item.proposedRenter.property.id,
        summaryLabel: propertySummary(item.proposedRenter.property),
        address: item.proposedRenter.property.address,
        city: item.proposedRenter.property.city,
        state: item.proposedRenter.property.state
      }
    }))
  };
}

export async function listAdminLandlordAgentActivities() {
  const items = await prisma.proposedRenterActivity.findMany({
    where: {
      actor: {
        accountType: {
          in: ["LANDLORD", "AGENT"]
        }
      }
    },
    include: {
      actor: true,
      proposedRenter: {
        select: {
          id: true,
          renterAccountId: true,
          firstName: true,
          lastName: true,
          organizationName: true,
          email: true,
          status: true,
          decision: true,
          property: true,
          rentScorePayments: {
            orderBy: { createdAt: "desc" },
            take: 1
          },
          scoreRequests: {
            include: {
              requestedBy: true,
              forwardedTo: true
            },
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  return {
    items: await Promise.all(
      items.map(async (item) => {
        const latestScoreRequest = item.proposedRenter.scoreRequests[0] || null;
        const latestPayment = item.proposedRenter.rentScorePayments[0] || null;
        const shareStatus = latestScoreRequest ? "APPROVED" : "NOT_REQUESTED";
        return {
          id: item.id,
          activityType: item.activityType,
          message: item.message,
          createdAt: item.createdAt,
          actor: item.actor
            ? {
                id: item.actor.id,
                accountType: item.actor.accountType,
                name: publicAccountDisplayName(item.actor),
                email: item.actor.email
              }
            : null,
          renter: {
            proposedRenterId: item.proposedRenter.id,
            accountId: item.proposedRenter.renterAccountId,
            name: item.proposedRenter.organizationName || `${item.proposedRenter.firstName} ${item.proposedRenter.lastName}`.trim(),
            email: item.proposedRenter.email,
            status: item.proposedRenter.status,
            decision: item.proposedRenter.decision
          },
          property: {
            id: item.proposedRenter.property.id,
            summaryLabel: propertySummary(item.proposedRenter.property),
            address: item.proposedRenter.property.address,
            city: item.proposedRenter.property.city,
            state: item.proposedRenter.property.state
          },
          latestScoreRequest: latestScoreRequest
            ? {
                id: latestScoreRequest.id,
                status: latestScoreRequest.status,
                createdAt: latestScoreRequest.createdAt,
                reviewedAt: latestScoreRequest.reviewedAt,
                requestedBy: publicAccountDisplayName(latestScoreRequest.requestedBy),
                forwardedTo: latestScoreRequest.forwardedTo ? publicAccountDisplayName(latestScoreRequest.forwardedTo) : null
              }
            : null,
          latestRentScorePayment: latestPayment
            ? {
                id: latestPayment.id,
                provider: latestPayment.provider,
                status: latestPayment.status,
                amountNgn: latestPayment.amountNgn,
                reference: latestPayment.reference,
                reportApprovedAt: latestPayment.reportApprovedAt
              }
            : null,
          shareApproval: {
            status: shareStatus,
            canApprove: false
          }
        };
      })
    )
  };
}

export async function createWorkspaceProposedRenter(input: {
  publicAccountId: string;
  propertyId: string;
  propertyUnitId: string;
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
  let supportsPropertyUnitColumn = await supportsProposedRenterPropertyUnitColumn();

  return prisma.$transaction(async (tx) => {
    const membership = await getPropertyMembership(input.publicAccountId, input.propertyId, tx);
    const propertyUnit = await tx.propertyUnit.findFirst({
      where: {
        id: input.propertyUnitId,
        propertyId: membership.propertyId
      }
    });

    if (!propertyUnit) {
      throw new AppError("Select a valid property unit", 400, "INVALID_PROPERTY_UNIT");
    }

    const requestedByMember = membership.property.members.find((member) => member.publicAccountId === input.publicAccountId);
    const requestedByName = requestedByMember ? publicAccountDisplayName(requestedByMember.account) : "A landlord";
    const requestedByAccountType =
      requestedByMember?.account.accountType === "LANDLORD" || requestedByMember?.account.accountType === "AGENT"
        ? requestedByMember.account.accountType
        : null;

    const matchedAccount = input.renterAccountId
      ? await tx.publicAccount.findUnique({
          where: { id: input.renterAccountId }
        })
      : await tx.publicAccount.findUnique({
          where: { email: normalizeEmail(input.email) }
        });

    if (matchedAccount && matchedAccount.accountType !== "RENTER") {
      throw new AppError(
        `This email already belongs to a ${matchedAccount.accountType.toLowerCase()} account. Only renter accounts can be linked as tenants.`,
        400,
        "INVALID_RENTER_ACCOUNT"
      );
    }

    const linkedAccount = canUseExistingRenterAccount(matchedAccount) ? matchedAccount : null;
    const renterEmail = linkedAccount?.email || normalizeEmail(input.email);
    const renterName = linkedAccount
      ? publicAccountDisplayName(linkedAccount)
      : [input.firstName.trim(), input.lastName.trim()].filter(Boolean).join(" ");

    const findExistingRenter = async (usePropertyUnitColumn: boolean) =>
      tx.proposedRenter.findFirst({
        where: usePropertyUnitColumn
          ? linkedAccount
            ? {
                propertyUnitId: input.propertyUnitId,
                decision: null,
                OR: [{ renterAccountId: linkedAccount.id }, { email: renterEmail }]
              }
            : {
                propertyUnitId: input.propertyUnitId,
                decision: null,
                email: renterEmail
              }
          : linkedAccount
            ? {
                propertyId: input.propertyId,
                decision: null,
                OR: [{ renterAccountId: linkedAccount.id }, { email: renterEmail }]
              }
            : {
                propertyId: input.propertyId,
                decision: null,
                email: renterEmail
              },
        select: {
          id: true
        }
      });

    let existingRenter;
    try {
      existingRenter = await findExistingRenter(supportsPropertyUnitColumn);
    } catch (error: unknown) {
      if (!supportsPropertyUnitColumn || !isMissingProposedRenterPropertyUnitColumn(error)) {
        throw error;
      }
      markProposedRenterPropertyUnitColumnUnsupported();
      supportsPropertyUnitColumn = false;
      existingRenter = await findExistingRenter(false);
    }

    if (existingRenter) {
      throw new AppError("This renter is already attached to the selected unit queue", 409, "RENTER_ALREADY_QUEUED");
    }

    const createPayload = {
      propertyId: input.propertyId,
      propertyUnitId: input.propertyUnitId,
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
    };

    const legacyCreatePayload = (({ propertyUnitId: _omittedPropertyUnitId, ...legacyPayload }) => legacyPayload)(createPayload);

    let renter;
    try {
      renter = supportsPropertyUnitColumn
        ? await tx.proposedRenter.create({
            data: createPayload,
            select: {
              id: true,
              firstName: true,
              lastName: true,
              organizationName: true
            }
          })
        : await tx.proposedRenter.create({
            data: legacyCreatePayload,
            select: {
              id: true,
              firstName: true,
              lastName: true,
              organizationName: true
            }
          });
    } catch (error: unknown) {
      if (!supportsPropertyUnitColumn || !isMissingProposedRenterPropertyUnitColumn(error)) {
        throw error;
      }
      markProposedRenterPropertyUnitColumnUnsupported();
      supportsPropertyUnitColumn = false;
      renter = await tx.proposedRenter.create({
        data: legacyCreatePayload,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          organizationName: true
        }
      });
    }

    const inviteState = await notifyProposedRenter({
      requestedByAccountId: input.publicAccountId,
      requestedByName,
      requestedByAccountType,
      propertySummaryLabel: [propertySummary(membership.property), propertyUnitSummary(propertyUnit)].filter(Boolean).join(" · "),
      propertyAddress: [membership.property.address, membership.property.city, membership.property.state].filter(Boolean).join(", "),
      renterEmail,
      renterName,
      existingAccountId: linkedAccount?.status === "ACTIVE" ? linkedAccount.id : null,
      tx
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
  const items = await prisma.proposedRenter
    .findMany({
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
    })
    .catch((error: unknown) => {
      if (isMissingProposedRenterPropertyUnitColumn(error)) {
        return prisma.proposedRenter.findMany({
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
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organizationName: true,
            email: true,
            phone: true,
            createdAt: true,
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
      }
      throw error;
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
  const proposedRenter = await prisma.proposedRenter
    .findUnique({
      where: { id: input.proposedRenterId },
      include: {
        property: true,
        renterAccount: true
      }
    })
    .catch((error: unknown) => {
      if (isMissingProposedRenterPropertyUnitColumn(error)) {
        return prisma.proposedRenter.findUnique({
          where: { id: input.proposedRenterId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organizationName: true,
            email: true,
            phone: true,
            property: true,
            renterAccount: true
          }
        });
      }
      throw error;
    });

  if (!proposedRenter) {
    throw new AppError("Proposed renter not found", 404, "PROPOSED_RENTER_NOT_FOUND");
  }

  const inviteState = await notifyProposedRenter({
    requestedByAccountId: input.adminUserId,
    requestedByName: "RentSure admin",
    requestedByAccountType: "ADMIN",
    propertySummaryLabel: propertySummary(proposedRenter.property),
    propertyAddress: [proposedRenter.property.address, proposedRenter.property.city, proposedRenter.property.state].filter(Boolean).join(", "),
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

    if (input.decision === "APPROVED" && proposedRenter.propertyUnitId) {
      const conflictingOccupancy = await tx.propertyUnit.findFirst({
        where: {
          id: proposedRenter.propertyUnitId,
          isOccupied: true,
          OR: [
            { currentTenantEmail: { not: proposedRenter.email } },
            { currentTenantPhone: { not: proposedRenter.phone } },
            { currentTenantName: { not: `${proposedRenter.firstName} ${proposedRenter.lastName}`.trim() } }
          ]
        },
        select: { id: true }
      });

      if (conflictingOccupancy) {
        throw new AppError(
          "This unit is already marked as occupied by another renter",
          400,
          "UNIT_ALREADY_OCCUPIED"
        );
      }
    }

    await tx.proposedRenter.update({
      where: { id: proposedRenter.id },
      data: {
        decision: input.decision,
        decisionAt: new Date(),
        decisionByAccountId: input.publicAccountId,
        decisionNote: input.note?.trim() || null,
        status: nextStatus
      } as any,
      select: { id: true }
    });

    if (input.decision === "APPROVED") {
      if (proposedRenter.propertyUnitId) {
        await tx.propertyUnit.update({
          where: { id: proposedRenter.propertyUnitId },
          data: {
            isOccupied: true,
            currentTenantName: `${proposedRenter.firstName} ${proposedRenter.lastName}`.trim(),
            currentTenantEmail: proposedRenter.email,
            currentTenantPhone: proposedRenter.phone
          }
        });

        const occupiedUnits = await tx.propertyUnit.findMany({
          where: {
            propertyId: proposedRenter.propertyId,
            isOccupied: true
          },
          select: {
            currentTenantName: true,
            currentTenantEmail: true,
            currentTenantPhone: true
          }
        });

        await tx.property.update({
          where: { id: proposedRenter.propertyId },
          data: {
            isOccupied: occupiedUnits.length > 0,
            currentTenantName: occupiedUnits.length === 1 ? occupiedUnits[0]?.currentTenantName ?? null : null,
            currentTenantEmail: occupiedUnits.length === 1 ? occupiedUnits[0]?.currentTenantEmail ?? null : null,
            currentTenantPhone: occupiedUnits.length === 1 ? occupiedUnits[0]?.currentTenantPhone ?? null : null
          }
        });
      } else {
        await tx.property.update({
          where: { id: proposedRenter.propertyId },
          data: {
            isOccupied: true,
            currentTenantName: `${proposedRenter.firstName} ${proposedRenter.lastName}`.trim(),
            currentTenantEmail: proposedRenter.email,
            currentTenantPhone: proposedRenter.phone
          }
        });
      }
    }

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

    const renterName =
      proposedRenter.organizationName || [proposedRenter.firstName, proposedRenter.lastName].filter(Boolean).join(" ") || "there";
    const resolvedUnit = inferLegacyPropertyUnit(proposedRenter);
    const propertyAddress = resolvedUnit
      ? formatPropertyAddress({
          address: resolvedUnit.address,
          city: resolvedUnit.city,
          state: resolvedUnit.state
        })
      : formatPropertyAddress({
          address: proposedRenter.property.address,
          city: proposedRenter.property.city,
          state: proposedRenter.property.state
        });

    if (proposedRenter.email?.trim()) {
      const delivery = await notifyRenterOfDecision({
        decision: input.decision,
        renterEmail: proposedRenter.email.trim(),
        renterName,
        propertyAddress,
        note: input.note
      });

      logger.info(
        {
          event: "workspace.renter_decision_notification",
          proposedRenterId: proposedRenter.id,
          renterEmail: proposedRenter.email.trim(),
          decision: input.decision,
          previewUrl: delivery.previewUrl || null,
          deliveryMode: delivery.deliveryMode
        },
        "Renter decision notification sent"
      );
    }

    return getWorkspaceQueueItem(input.publicAccountId, proposedRenter.id, tx);
  });
}

export async function requestWorkspaceRentScore(input: {
  publicAccountId: string;
  proposedRenterId: string;
  notes?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const currentAccount = await getWorkspaceAccount(input.publicAccountId, tx);
    const proposedRenter = await getAccessibleProposedRenter(input.publicAccountId, input.proposedRenterId, tx);

    const existingScoreRequest = await tx.scoreRequest.findFirst({
      where: { proposedRenterId: proposedRenter.id },
      select: { id: true }
    });

    if (existingScoreRequest) {
      throw new AppError("Rent score has already been requested for this renter", 400, "VALIDATION_ERROR");
    }

    await tx.scoreRequest.create({
      data: {
        proposedRenterId: proposedRenter.id,
        requestedByAccountId: currentAccount.id,
        notes: input.notes?.trim() || null,
        status: "REQUESTED"
      }
    });

    await tx.proposedRenter.update({
      where: { id: proposedRenter.id },
      data: { status: "SCORE_REQUESTED" },
      select: { id: true }
    });

    await logProposedRenterActivity({
      proposedRenterId: proposedRenter.id,
      actorAccountId: currentAccount.id,
      activityType: "SCORE_REQUESTED",
      message: "Rent score review requested for this renter.",
      metadata: input.notes?.trim() ? ({ note: input.notes.trim() } as Prisma.JsonObject) : undefined,
      tx
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
      select: {
        id: true,
        proposedRenter: {
          select: {
            id: true,
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
      data: { status: "SCORE_SHARED" },
      select: { id: true }
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

export async function confirmWorkspacePaymentSchedule(input: {
  publicAccountId: string;
  paymentScheduleId: string;
  paidAt?: Date | null;
  note?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const actor = await getWorkspaceAccount(input.publicAccountId, tx);
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

    if (!schedule.confirmationInitiatedAt) {
      throw new AppError("Await renter proof of payment before confirming this schedule", 400, "PAYMENT_CONFIRMATION_NOT_READY");
    }

    const paidAt = input.paidAt ?? schedule.paidAt ?? new Date();
    const timing = resolvePaymentTiming(schedule.dueDate, paidAt);

    await tx.paymentSchedule.update({
      where: { id: schedule.id },
      data: {
        status: "PAID",
        paidAt,
        confirmedAt: new Date(),
        confirmedByAccountId: input.publicAccountId,
        confirmationTiming: timing,
        confirmationNote: input.note?.trim() || schedule.confirmationNote || null
      }
    });

    const linkedRenterAccountId = await tx.proposedRenter
      .findUnique({
        where: { id: schedule.proposedRenterId },
        select: { renterAccountId: true }
      })
      .then((item) => item?.renterAccountId || null);

    if (actor.accountType === "LANDLORD" && linkedRenterAccountId) {
      if (schedule.paymentType === "RENT" && timing === "ON_TIME") {
        await recordRentScoreEvent({
          publicAccountId: linkedRenterAccountId,
          ruleCode: "RENT_PAID_ON_TIME",
          quantity: 1,
          sourceNote: "Landlord confirmed on-time rent payment"
        });
      }

      if (schedule.paymentType === "UTILITY" && timing === "ON_TIME") {
        await recordRentScoreEvent({
          publicAccountId: linkedRenterAccountId,
          ruleCode: "CONSISTENT_UTILITY_PAYMENT",
          quantity: 1,
          sourceNote: "Landlord confirmed on-time utility payment"
        });
      }
    }

    await logProposedRenterActivity({
      proposedRenterId: schedule.proposedRenterId,
      actorAccountId: input.publicAccountId,
      activityType: "PAYMENT_CONFIRMED",
      message:
        actor.accountType === "LANDLORD"
          ? `Landlord confirmed payment as ${timing === "ON_TIME" ? "on time" : "late"}.`
          : "Payment confirmed by workspace.",
      metadata: {
        paymentScheduleId: schedule.id,
        confirmedBy: actor.accountType,
        timing
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
