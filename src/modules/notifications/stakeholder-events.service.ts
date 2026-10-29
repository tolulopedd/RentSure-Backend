import type { Prisma, ProposedRenterActivity } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { notifyAdmins, notifyUser } from "./notifications.service";
import type { NotificationDb } from "./notification-email.service";

const titles: Record<string, string> = {
  CREATED: "Renter linked to property", LINK_ACCEPTED: "Property link accepted", LINK_WITHDRAWN: "Property link withdrawn",
  SCORE_REQUESTED: "Rent Score requested", SCORE_REQUEST_ACCEPTED: "Rent Score request accepted", SCORE_FORWARDED: "Rent Score report shared",
  DECISION: "Rental application decision", PAYMENT_SCHEDULE_CREATED: "Payment schedule created",
  PAYMENT_SCHEDULE_UPDATED: "Payment status updated", PAYMENT_CONFIRMATION_INITIATED: "Payment proof submitted",
  PAYMENT_CONFIRMED: "Payment reviewed", RENTER_PAYMENT_CONFIRMED: "Renter confirmed payment", COMMENT: "New application activity"
};

// Reuse the existing activity record as the event identity. No notifications on reads.
export async function recordNotifiableActivity(db: NotificationDb, args: { data: Prisma.ProposedRenterActivityUncheckedCreateInput }): Promise<ProposedRenterActivity> {
  if (db === prisma) return prisma.$transaction(tx => recordNotifiableActivity(tx, args));
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`activity:${args.data.proposedRenterId}:${args.data.activityType}`}, 0))`;
  const previous = await db.proposedRenterActivity.findFirst({
    where: { proposedRenterId: args.data.proposedRenterId, activityType: args.data.activityType }, orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  const activity = await db.proposedRenterActivity.create(args);
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return JSON.stringify(value.map(item => canonical(item)));
    if (value && typeof value === "object") return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return JSON.stringify(value ?? null);
  };
  if (!["COMMENT", "CREATED", "PAYMENT_SCHEDULE_CREATED"].includes(activity.activityType) && previous &&
      previous.actorAccountId === activity.actorAccountId && previous.message === activity.message && canonical(previous.metadata) === canonical(activity.metadata)) return activity;
  const linkedCase = await db.proposedRenter.findUnique({ where: { id: activity.proposedRenterId },
    include: { property: { include: { members: true } }, scoreRequests: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!linkedCase) return activity;
  const meta = (activity.metadata ?? {}) as Record<string, unknown>;
  const kind = activity.activityType;
  if (activity.message.startsWith("Existing RentSure member linked") || activity.message.startsWith("Invite queued for this renter")) return activity;
  if (meta.adminUserId && meta.paymentId) return activity; // Payment/report approval already has one dedicated event.
  const isPayment = kind.includes("PAYMENT");
  const isReference = typeof meta.landlordAccountId === "string" || typeof meta.requestId === "string";
  const isBehaviour = Boolean(meta.propertyMaintenanceRating);
  const recipients = new Set(linkedCase.property.members.map(member => member.publicAccountId));
  // Ordinary comments are internal landlord/agent notes. Do not disclose them to renters.
  if (linkedCase.renterAccountId && kind !== "CREATED" && (kind !== "COMMENT" || isReference || isBehaviour)) recipients.add(linkedCase.renterAccountId);
  if (kind === "SCORE_REQUESTED" || kind === "SCORE_REQUEST_ACCEPTED") {
    recipients.clear();
    const request = linkedCase.scoreRequests[0];
    if (kind === "SCORE_REQUESTED" && linkedCase.renterAccountId) recipients.add(linkedCase.renterAccountId);
    if (kind === "SCORE_REQUEST_ACCEPTED" && request) recipients.add(request.forwardedToAccountId ?? request.requestedByAccountId);
  }
  if (typeof meta.landlordAccountId === "string") { recipients.clear(); recipients.add(meta.landlordAccountId); }
  // Explicit report shares are delivered separately to the chosen recipient only.
  if (kind === "SCORE_FORWARDED" && meta.recipientEmail) return activity;
  if (kind === "SCORE_FORWARDED") {
    recipients.clear();
    const request = linkedCase.scoreRequests[0];
    if (request) recipients.add(request.forwardedToAccountId ?? request.requestedByAccountId);
  }
  if (activity.actorAccountId) recipients.delete(activity.actorAccountId);
  for (const id of recipients) {
    const renter = id === linkedCase.renterAccountId;
    const base = renter ? (kind === "DECISION" && meta.decision === "HOLD" ? "/account/renter/queue" : isPayment ? "/account/renter/payments" : "/account/renter/cases") : (isPayment ? "/account/payments" : "/account/queue");
    const title = kind === "DECISION" && meta.decision === "HOLD" ? "Additional information requested" : isReference ? "Landlord reference update" : isBehaviour ? "Renter behaviour review updated" : titles[kind];
    const action = kind === "DECISION" && meta.decision === "HOLD" ? "Open the request to provide the selected information and submit it to the landlord."
      : typeof meta.landlordAccountId === "string" ? "Open the linked renter record to provide or decline the reference."
      : kind === "SCORE_REQUESTED" ? "Open the request to accept and share your report."
      : kind === "PAYMENT_CONFIRMATION_INITIATED" ? "Open Payments to review the submitted proof."
      : kind === "PAYMENT_SCHEDULE_CREATED" ? "Check the amount and due date in Payments."
      : "Open the record to review the update.";
    await notifyUser({ db, recipientAccountId: id, event: "STAKEHOLDER_UPDATE", eventKey: `activity:${activity.id}`,
      title, message: `${linkedCase.property.name}: ${kind === "COMMENT" && !isReference && !isBehaviour ? "A new comment was added to the linked renter record." : activity.message} ${action}`,
      actionUrl: `${base}?caseId=${linkedCase.id}${meta.paymentScheduleId ? `&paymentId=${meta.paymentScheduleId}` : ""}`,
      actionLabel: renter && kind === "DECISION" && meta.decision === "HOLD" ? "Provide information" : "View record", relatedEntityType: "PROPOSED_RENTER", relatedEntityId: linkedCase.id });
  }
  return activity;
}

export async function notifyScorePayment(paymentId: string, db: NotificationDb = prisma) {
  const payment = await db.rentScorePayment.findUnique({ where: { id: paymentId }, include: { requestedBy: true } });
  if (!payment) return;
  const status = payment.reportApprovedAt ? "REPORT_APPROVED" : payment.status;
  const messages: Record<string, string> = {
    PENDING_ACTION: "Your Rent Score payment is ready. Open the payment page to complete it.",
    AWAITING_MANUAL_CONFIRMATION: "Your Rent Score transfer request is awaiting admin confirmation. Use the payment instructions and reference on the payment page.",
    SUCCEEDED: "Your Rent Score payment was confirmed. Your report is awaiting admin approval.",
    FAILED: "Your Rent Score payment was not completed. Open the payment page to check its status or try again.",
    CANCELLED: "Your Rent Score payment was cancelled. Open the payment page if you want to start again.",
    REPORT_APPROVED: "Your Rent Score report is approved and ready. Open RentSure to view it."
  };
  if (!messages[status]) return;
  await notifyUser({ db, recipientAccountId: payment.requestedByAccountId, event: "PAYMENT_UPDATE",
    eventKey: `score-payment:${payment.id}:${status}`, title: status === "REPORT_APPROVED" ? "Rent Score report approved" : "Rent Score payment update",
    message: `${messages[status]} Reference: ${payment.reference}.`,
    actionUrl: payment.requestedBy.accountType === "RENTER" ? `/account/renter/buy-score?rentScorePaymentRef=${payment.reference}` : `/account/decisions?caseId=${payment.proposedRenterId ?? ""}`,
    relatedEntityType: "RENT_SCORE_PAYMENT", relatedEntityId: payment.id });
  if (status === "AWAITING_MANUAL_CONFIRMATION" || status === "SUCCEEDED") {
    await notifyAdmins({ db, event: "PAYMENT_UPDATE", eventKey: `score-payment:${payment.id}:${status}`,
      title: status === "SUCCEEDED" ? "Rent Score report needs approval" : "Manual payment needs confirmation",
      message: `Payment ${payment.reference} (${payment.amountNgn} NGN) ${status === "SUCCEEDED" ? "has been confirmed. Review and approve the report." : "is awaiting confirmation. Verify the transfer before confirming."}`,
      actionUrl: `/app/dashboard?paymentId=${payment.id}`, relatedEntityType: "RENT_SCORE_PAYMENT", relatedEntityId: payment.id });
  }
}
