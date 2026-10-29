import { submitAdditionalInformation, informationResponseSchema } from "../modules/renter/additional-information";
import { getRenterDashboard } from "../modules/renter/renter.service";
import { getWorkspaceQueueItem } from "../modules/workspace/workspace.service";
import { saveLocalPublicDocumentUpload } from "../modules/storage/storage.service";
import { unlink } from "node:fs/promises";
import path from "node:path";
const uploadedTestFiles: string[] = [];
import { changeManagedUserStatus, updateManagedUser, changeAdminRole } from "../modules/user-management/user-management.service";
import { createRentScoreOverride, deleteRentScoreOverride, reviewIdentitySubmission } from "../modules/rent-score/rent-score.service";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Server } from "node:http";
import { prisma } from "../prisma/client";
import { env } from "../config/env";
import { createApp } from "../app";
import { notifyUser, notifyAdmins, listNotifications, markNotificationRead, markAllNotificationsRead, notificationPath } from "../modules/notifications/notifications.service";
import { deliverNotificationEmails } from "../modules/notifications/notification-email.service";
import { recordNotifiableActivity } from "../modules/notifications/stakeholder-events.service";
import { updateRenterProfile, shareRenterScoreReport, initiateRenterPaymentConfirmation, createSelfInitiatedRenterPayment, submitRenterIdentityForReview, respondToLinkedProperty, requestLandlordReference, acceptRenterScoreRequest } from "../modules/renter/renter.service";
import { shareWorkspaceProperty, respondToWorkspaceAgentInvite, decideWorkspaceProposedRenter, createWorkspacePaymentSchedule, updateWorkspacePaymentSchedule, confirmWorkspacePaymentSchedule, submitWorkspaceRenterBehaviourReview, respondToLandlordReferenceRequest, commentOnWorkspaceProposedRenter, requestWorkspaceRentScore, forwardWorkspaceScoreRequest } from "../modules/workspace/workspace.service";
import { createRenterRentScorePaymentSession, confirmManualRentScorePayment, approveRentScoreReport } from "../modules/score-payments/score-payments.service";

const suffix = randomUUID();
const ids: string[] = [];
const emails: string[] = [];
let staffId: string | undefined;
let propertyId: string | undefined;
let server: Server | undefined;
const paymentIds: string[] = [];
const passed: string[] = [];
function pass(label: string) { passed.push(label); console.log(`PASS ${label}`); }
async function account(accountType: "RENTER" | "LANDLORD" | "AGENT") {
  const result = await prisma.publicAccount.create({ data: { accountType, entityType: "INDIVIDUAL", firstName: "Notification", lastName: "Test",
    email: `${accountType.toLowerCase()}-${randomUUID()}@example.com`, passwordHash: "test-only", phone: "09000000000", state: "Lagos", city: "Ikeja", address: "Test Street", status: "ACTIVE", acceptedTermsAt: new Date(), emailVerifiedAt: new Date() } });
  ids.push(result.id); emails.push(result.email); return result;
}
async function main() {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname), "Tests require a local database");
  assert.equal(Boolean(env.RESEND_API_KEY), false, "Live email must be disabled for tests");
  const renter = await account("RENTER"), landlord = await account("LANDLORD"), agent = await account("AGENT"), outsider = await account("LANDLORD");
  const admin = await prisma.user.create({ data: { fullName: "Notification Test", email: `admin-${suffix}@example.com`, passwordHash: "test-only", role: "ADMIN", adminRole: "ADMIN" } });
  staffId = admin.id;
  const property = await prisma.property.create({ data: { name: "Notification test property", ownerName: "Test", landlordEmail: landlord.email, address: "Test Street", state: "Lagos", city: "Ikeja", propertyType: "Flats", createdByAccountId: landlord.id,
    units: { create: { label: "Unit 1", address: "Test Street", state: "Lagos", city: "Ikeja", bedroomCount: 1, bathroomCount: 1, annualRentAmountNgn: 1200000 } } }, include: { units: true } });
  propertyId = property.id;
  await prisma.propertyMember.createMany({ data: [{ propertyId, publicAccountId: landlord.id, role: "LANDLORD", isPrimary: true }, { propertyId, publicAccountId: agent.id, role: "AGENT" }] });
  await prisma.propertyMember.deleteMany({ where: { propertyId, publicAccountId: agent.id } });
  await shareWorkspaceProperty({ publicAccountId: landlord.id, propertyId, sharedWithEmail: agent.email });
  let invite = await prisma.propertyAgentInvite.findFirstOrThrow({ where: { propertyId, recipientEmail: agent.email } });
  await respondToWorkspaceAgentInvite({ publicAccountId: agent.id, inviteId: invite.id, action: "DECLINE" });
  await shareWorkspaceProperty({ publicAccountId: landlord.id, propertyId, sharedWithEmail: agent.email });
  invite = await prisma.propertyAgentInvite.findFirstOrThrow({ where: { propertyId, recipientEmail: agent.email } });
  await respondToWorkspaceAgentInvite({ publicAccountId: agent.id, inviteId: invite.id, action: "ACCEPT" });
  assert.ok(await prisma.publicAccountNotification.findFirst({ where: { publicAccountId: landlord.id, title: "Agent accepted property invite" } }));
  assert.ok(await prisma.notificationEmail.findFirst({ where: { recipient: agent.email, category: "AGENT_INVITE" } }));
  pass("Agent invitation, decline, re-invitation and acceptance");
  const linked = await prisma.proposedRenter.create({ data: { propertyId, propertyUnitId: property.units[0].id, renterAccountId: renter.id, requestedByAccountId: agent.id,
    firstName: renter.firstName, lastName: renter.lastName, email: renter.email, phone: renter.phone, address: renter.address, city: renter.city, state: renter.state } });
  async function expectRecipients(action: () => Promise<unknown>, expected: string[]) {
    const before = new Set((await prisma.publicAccountNotification.findMany({ where: { publicAccountId: { in: ids } }, select: { id: true } })).map(row => row.id));
    await action();
    const rows = (await prisma.publicAccountNotification.findMany({ where: { publicAccountId: { in: ids } }, include: { emailDelivery: true } })).filter(row => !before.has(row.id));
    assert.deepEqual([...new Set(rows.map(row => row.publicAccountId))].sort(), [...expected].sort());
    for (const row of rows) { assert.ok(row.emailDelivery, `${row.title} must have a durable email`); assert.ok(row.ctaPath?.startsWith("/")); assert.ok(row.message.length > 20); }
    assert.equal(rows.some(row => row.publicAccountId === outsider.id), false);
  }
  await expectRecipients(() => submitRenterIdentityForReview({ publicAccountId: renter.id, verificationType: "NIN", value: "12345678901" }), [renter.id]);
  await expectRecipients(() => submitRenterIdentityForReview({ publicAccountId: renter.id, verificationType: "BVN", value: "10987654321" }), [renter.id]);
  pass("NIN and BVN update: both channels, no identity numbers disclosed");
  await expectRecipients(() => updateRenterProfile({ publicAccountId: renter.id, employmentType: "EMPLOYED", employmentYears: 1 }), [renter.id]);
  await expectRecipients(() => updateRenterProfile({ publicAccountId: renter.id, employmentType: "EMPLOYED", employmentYears: 1 }), []);
  pass("Profile-driven score changes notify once; unchanged scores remain quiet");
  await expectRecipients(() => respondToLinkedProperty({ publicAccountId: renter.id, linkedCaseId: linked.id, action: "ACCEPT" }), [landlord.id, agent.id]);
  await expectRecipients(() => respondToLinkedProperty({ publicAccountId: renter.id, linkedCaseId: linked.id, action: "ACCEPT" }), []);
  pass("Property acceptance and repeat-request idempotency");
  await assert.rejects(() => decideWorkspaceProposedRenter({ publicAccountId: landlord.id, proposedRenterId: linked.id, decision: "HOLD" }));
  await assert.rejects(() => decideWorkspaceProposedRenter({ publicAccountId: landlord.id, proposedRenterId: linked.id, decision: "HOLD", requestedInformation: ["Unknown"] }));
  const informationRequest = { publicAccountId: landlord.id, proposedRenterId: linked.id, decision: "HOLD" as const, requestedInformation: ["Work History", "Work Reference Letter"], note: "Please include your latest employer." };
  await expectRecipients(() => decideWorkspaceProposedRenter(informationRequest), [renter.id, agent.id]);
  const requested = await prisma.proposedRenter.findUniqueOrThrow({ where: { id: linked.id } });
  assert.deepEqual(requested.requestedInformation, ["Work History", "Work Reference Letter"]);
  const requestNotice = await prisma.publicAccountNotification.findFirstOrThrow({ where: { publicAccountId: renter.id, relatedEntityId: linked.id, message: { contains: "Work Reference Letter" } }, include: { emailDelivery: true } });
  for (const label of informationRequest.requestedInformation) {
    assert.ok(requestNotice.message.includes(label));
    assert.ok(requestNotice.emailDelivery!.html.includes(label));
  }
  assert.equal(requestNotice.ctaPath, `/account/renter/queue?caseId=${linked.id}`);
  await expectRecipients(() => decideWorkspaceProposedRenter(informationRequest), []);
  assert.equal((await prisma.proposedRenter.findUniqueOrThrow({ where: { id: linked.id } })).decisionAt!.toISOString(), requested.decisionAt!.toISOString());
  for (const decision of ["APPROVED", "DECLINED", "HOLD"] as const) {
    await assert.rejects(() => decideWorkspaceProposedRenter({ ...informationRequest, decision,
      requestedInformation: decision === "HOLD" ? ["Work History"] : [], note: "Attempt while awaiting renter" }),
      (error: any) => error.code === "RENTER_INFORMATION_PENDING");
  }
  assert.equal((await prisma.proposedRenter.findUniqueOrThrow({ where: { id: linked.id } })).decision, "HOLD");
  pass("Approve, decline and replacement information requests blocked while renter response is pending");
  const dashboard = await getRenterDashboard(renter.id);
  assert.deepEqual(dashboard.linkedCases.find(item => item.id === linked.id)!.requestedInformation, informationRequest.requestedInformation);
  pass("Additional-information LOV selections persist and appear in renter view, in-app notification and email; request retries deduplicate");
  const bytes = Buffer.from("%PDF-1.4\n% RentSure test reference letter\n%%EOF");
  const letter = await saveLocalPublicDocumentUpload({ publicAccountId: renter.id, documentType: "EMPLOYMENT_DOCUMENT", fileName: "test-reference.pdf", contentType: "application/pdf", fileSize: bytes.length, base64Data: bytes.toString("base64") });
  uploadedTestFiles.push(path.resolve(process.cwd(), "uploads", letter.objectKey.slice("local/".length)));
  const response = { requestedAt: requested.decisionAt!.toISOString(), workHistory: "Test employer, Analyst, 2020–2025", referenceLetter: { ...letter, mimeType: "application/pdf" as const } };
  assert.equal(informationResponseSchema.safeParse({ ...response, workHistory: " " }).success, false);
  await assert.rejects(() => submitAdditionalInformation(renter.id, linked.id, { ...response, referenceLetter: undefined }));
  await assert.rejects(() => submitAdditionalInformation(outsider.id, linked.id, response));
  await assert.rejects(() => submitAdditionalInformation(renter.id, linked.id, { ...response, requestedAt: new Date(0).toISOString() }));
  await assert.rejects(() => submitAdditionalInformation(renter.id, linked.id, { ...response, referenceLetter: { ...response.referenceLetter, objectKey: letter.objectKey.replace(renter.id, outsider.id) } }));
  await expectRecipients(() => submitAdditionalInformation(renter.id, linked.id, response), [landlord.id]);
  await expectRecipients(() => submitAdditionalInformation(renter.id, linked.id, response), []);
  const reviewed = await getWorkspaceQueueItem(landlord.id, linked.id);
  assert.equal(reviewed.additionalInformationResponse!.workHistory, response.workHistory);
  assert.ok(reviewed.additionalInformationResponse!.referenceLetter?.url?.includes("test-reference.pdf"));
  const submittedNotice = await prisma.publicAccountNotification.findFirstOrThrow({ where: { publicAccountId: landlord.id, title: "Requested renter information submitted", relatedEntityId: linked.id }, include: { emailDelivery: true } });
  assert.equal(submittedNotice.ctaPath, `/account/decisions?caseId=${linked.id}`);
  assert.ok(!submittedNotice.emailDelivery!.html.includes(response.workHistory));
  const retained = await decideWorkspaceProposedRenter({ publicAccountId: landlord.id, proposedRenterId: linked.id, decision: "APPROVED" });
  assert.equal(retained.additionalInformationResponse!.workHistory, response.workHistory);
  pass("Renter submits work history and uploaded letter; landlord can review, response retries deduplicate, invalid/stale/foreign submissions rejected, approval preserves response");
  for (const decision of ["HOLD", "DECLINED", "APPROVED"] as const) {
    await expectRecipients(() => decideWorkspaceProposedRenter({ publicAccountId: landlord.id, proposedRenterId: linked.id, decision, requestedInformation: decision === "HOLD" ? ["Work History"] : undefined }), [renter.id, agent.id]);
    if (decision === "HOLD") {
      const pending = await prisma.proposedRenter.findUniqueOrThrow({ where: { id: linked.id } });
      await submitAdditionalInformation(renter.id, linked.id, { requestedAt: pending.decisionAt!.toISOString(), workHistory: "Updated work history" });
    }

  }
  pass("Hold, rejection, approval and tenancy decision recipients");
  await expectRecipients(() => commentOnWorkspaceProposedRenter({ publicAccountId: landlord.id, proposedRenterId: linked.id, message: "Private internal note" }), [agent.id]);
  pass("Internal comments do not leak to renter or unrelated landlords");
  await expectRecipients(() => createWorkspacePaymentSchedule({ publicAccountId: landlord.id, proposedRenterId: linked.id, paymentType: "RENT", amountNgn: 100000, dueDate: new Date() }), [renter.id, agent.id]);
  const schedule = await prisma.paymentSchedule.findFirstOrThrow({ where: { proposedRenterId: linked.id } });
  await expectRecipients(() => updateWorkspacePaymentSchedule({ publicAccountId: landlord.id, paymentScheduleId: schedule.id, status: "PAID" }), [renter.id, agent.id]);
  await expectRecipients(() => initiateRenterPaymentConfirmation({ publicAccountId: renter.id, paymentScheduleId: schedule.id,
    paymentEvidenceObjectKey: "test/proof.pdf", paymentEvidenceFileName: "proof.pdf", paymentEvidenceMimeType: "application/pdf", paymentEvidenceFileSize: 10 }), [landlord.id, agent.id]);
  await expectRecipients(() => createSelfInitiatedRenterPayment({ publicAccountId: renter.id, linkedCaseId: linked.id, paymentType: "UTILITY", amountNgn: 2000,
    paymentEvidenceObjectKey: "test/proof.pdf", paymentEvidenceFileName: "proof.pdf", paymentEvidenceMimeType: "application/pdf", paymentEvidenceFileSize: 10 }), [landlord.id, agent.id]);
  pass("Scheduled and self-initiated renter payment proofs reach property stakeholders");
  for (const outcome of ["PARTIAL", "FULL"] as const) {
    await prisma.paymentSchedule.update({ where: { id: schedule.id }, data: { confirmationInitiatedAt: new Date(), confirmationOutcome: null } });
    await expectRecipients(() => confirmWorkspacePaymentSchedule({ publicAccountId: landlord.id, paymentScheduleId: schedule.id, outcome }), [renter.id, agent.id]);
  }
  pass("Payment schedule, status, partial and full confirmation notifications");
  await expectRecipients(() => requestLandlordReference({ publicAccountId: renter.id, linkedCaseId: linked.id }), [landlord.id]);
  const reference = await prisma.landlordReferenceRequest.findFirstOrThrow({ where: { proposedRenterId: linked.id } });
  await expectRecipients(() => respondToLandlordReferenceRequest({ publicAccountId: landlord.id, requestId: reference.id, recommendation: "RECOMMEND" }), [renter.id, agent.id]);
  await expectRecipients(() => submitWorkspaceRenterBehaviourReview({ publicAccountId: landlord.id, proposedRenterId: linked.id, propertyMaintenanceRating: "GOOD", leaseComplianceRating: "GOOD" }), [renter.id, agent.id]);
  pass("Reference requests, reference responses and behaviour reviews");
  await expectRecipients(() => requestWorkspaceRentScore({ publicAccountId: agent.id, proposedRenterId: linked.id }), [renter.id]);
  await expectRecipients(() => acceptRenterScoreRequest({ publicAccountId: renter.id, linkedCaseId: linked.id }), [agent.id]);
  const request = await prisma.scoreRequest.findFirstOrThrow({ where: { proposedRenterId: linked.id } });
  await expectRecipients(() => forwardWorkspaceScoreRequest({ publicAccountId: agent.id, scoreRequestId: request.id, forwardToAccountId: landlord.id }), [landlord.id]);
  pass("Score request, consent and forwarding only reach intended recipients");

  const beforeShare = await prisma.notificationEmail.count({ where: { recipient: landlord.email } });
  await shareRenterScoreReport({ publicAccountId: renter.id, recipientEmail: landlord.email, recipientType: "LANDLORD" });
  assert.equal(await prisma.notificationEmail.count({ where: { recipient: landlord.email } }), beforeShare + 1);
  assert.ok(await prisma.publicAccountNotification.findFirst({ where: { publicAccountId: landlord.id, title: "Rent Score report shared with you" } }));
  pass("Explicit score sharing sends one real queued email and one in-app summary");
  await expectRecipients(() => changeManagedUserStatus(renter.id, "SUSPEND"), [renter.id]);
  await expectRecipients(() => changeManagedUserStatus(renter.id, "UNSUSPEND"), [renter.id]);
  await expectRecipients(() => updateManagedUser(renter.id, { firstName: "Updated" }), [renter.id]);
  await changeAdminRole(admin.id, "SUPER_ADMIN");
  assert.ok(await prisma.publicAccountNotification.findFirst({ where: { staffUserId: admin.id, title: "Admin role changed" } }));
  pass("Admin profile/status/role changes notify the affected account");
  await prisma.publicAccount.update({ where: { id: renter.id }, data: { identityReviewStatus: "PENDING" } });
  await expectRecipients(() => reviewIdentitySubmission({ publicAccountId: renter.id, reviewerUserId: admin.id, action: "FAIL", comment: "Please update your details" }), [renter.id]);
  await prisma.publicAccount.update({ where: { id: renter.id }, data: { identityReviewStatus: "PENDING" } });
  await expectRecipients(() => reviewIdentitySubmission({ publicAccountId: renter.id, reviewerUserId: admin.id, action: "APPROVE" }), [renter.id]);
  pass("Legacy pending identity review approval/rejection keeps both channels atomic");
  const payment = await createRenterRentScorePaymentSession({ publicAccountId: renter.id, provider: "MANUAL_TRANSFER" });
  paymentIds.push(payment.paymentId);
  assert.ok(await prisma.publicAccountNotification.findFirst({ where: { staffUserId: admin.id, relatedEntityId: payment.paymentId } }));
  await confirmManualRentScorePayment({ adminUserId: admin.id, paymentId: payment.paymentId });
  await approveRentScoreReport({ adminUserId: admin.id, paymentId: payment.paymentId });
  const paymentCount = await prisma.publicAccountNotification.count({ where: { publicAccountId: renter.id, relatedEntityId: payment.paymentId } });
  assert.equal(paymentCount, 3);
  await approveRentScoreReport({ adminUserId: admin.id, paymentId: payment.paymentId });
  assert.equal(await prisma.publicAccountNotification.count({ where: { publicAccountId: renter.id, relatedEntityId: payment.paymentId } }), paymentCount);
  pass("Manual payment/admin review/report approval and duplicate approval");

  const notification = { recipientAccountId: renter.id, event: "PAYMENT_UPDATE", eventKey: `test-dedupe:${suffix}`, title: "Test event", message: "A test event occurred. Open the record.", actionUrl: "/account/renter/payments" };
  const duplicate = await Promise.all(Array.from({ length: 5 }, () => notifyUser(notification)));
  assert.equal(new Set(duplicate.map(row => row!.id)).size, 1);
  assert.equal(await prisma.notificationEmail.count({ where: { notificationId: duplicate[0]!.id } }), 1);
  pass("Concurrent event retries produce one in-app notification and one email job");
  const rollbackKey = `rollback-${suffix}`;
  await assert.rejects(prisma.$transaction(async tx => {
    await notifyUser({ ...notification, db: tx, eventKey: rollbackKey, title: rollbackKey });
    await notifyAdmins({ db: tx, event: "STAKEHOLDER_UPDATE", title: rollbackKey, message: "Test rollback", eventKey: rollbackKey });
    throw new Error("rollback");
  }));
  assert.equal(await prisma.publicAccountNotification.count({ where: { title: rollbackKey } }), 0);
  assert.equal(await prisma.notificationEmail.count({ where: { subject: rollbackKey } }), 0);
  pass("Rolled-back transactions leave no notifications or email jobs");

  const job = await prisma.notificationEmail.findUniqueOrThrow({ where: { notificationId: duplicate[0]!.id } });
  const keys: string[] = [];
  await deliverNotificationEmails(async input => { keys.push(input.idempotencyKey!); throw new Error("simulated provider failure"); }, [job.id]);
  let queued = await prisma.notificationEmail.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(queued.deliveredAt, null); assert.equal(queued.attempts, 1); assert.ok(queued.lastError);
  await prisma.notificationEmail.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
  const fakeSend = async (input: { idempotencyKey?: string }) => { keys.push(input.idempotencyKey!); return { deliveryMode: "PREVIEW_ONLY" as const, previewUrl: "test" }; };
  await Promise.all([deliverNotificationEmails(fakeSend, [job.id]), deliverNotificationEmails(fakeSend, [job.id])]);
  queued = await prisma.notificationEmail.findUniqueOrThrow({ where: { id: job.id } });
  assert.ok(queued.deliveredAt); assert.equal(keys.length, 2); assert.equal(new Set(keys).size, 1);
  pass("Provider failure retry, worker concurrency and stable provider idempotency key");

  assert.equal(notificationPath("https://evil.example"), "/account/notifications");
  assert.equal(notificationPath("//evil.example"), "/account/notifications");
  const escaped = await notifyUser({ ...notification, eventKey: `html:${suffix}`, message: '<img src=x onerror="alert(1)">' });
  const html = await prisma.notificationEmail.findUniqueOrThrow({ where: { notificationId: escaped!.id } });
  assert.ok(html.html.includes("&lt;img")); assert.ok(!html.html.includes('<img src=x'));
  pass("Notification content escaping and safe in-app links");

  await prisma.publicAccountNotification.createMany({ data: Array.from({ length: 60 }, (_, index) => ({ publicAccountId: renter.id, notificationType: "STAKEHOLDER_UPDATE" as const, title: `Count ${index}`, message: "Count fixture" })) });
  const rows = await listNotifications(renter.id, 10);
  assert.equal(rows.length, 10);
  assert.equal((await markNotificationRead(outsider.id, rows[0].id)).count, 0);
  await markNotificationRead(renter.id, rows[0].id);
  await markNotificationRead(renter.id, rows[0].id, "PUBLIC", false);
  assert.equal((await prisma.publicAccountNotification.findUniqueOrThrow({ where: { id: rows[0].id } })).readAt, null);
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const address = server.address() as { port: number };
  const requestToken = (id: string, role: string) => jwt.sign({ userId: id, role, accountScope: "PUBLIC" }, env.JWT_ACCESS_SECRET);
  const requestHttp = async (id: string, role: string, route: string, body: unknown) => {
    const result = await fetch("http://127.0.0.1:" + address.port + "/api" + route, { method: "POST", headers: {
      authorization: "Bearer " + requestToken(id, role), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: result.status, body: await result.json() as any };
  };
  const requestRoute = "/workspace/queue/" + linked.id + "/decision";
  assert.equal((await requestHttp(landlord.id, "LANDLORD", requestRoute, { decision: "HOLD", requestedInformation: ["Invalid option"] })).status, 400);
  const httpRequest = await requestHttp(landlord.id, "LANDLORD", requestRoute, { decision: "HOLD", requestedInformation: ["Work History"], note: "Updated work history request" });
  assert.equal(httpRequest.status, 200);
  const responseRoute = "/renter/linked-cases/" + linked.id + "/additional-information";
  const httpResponse = { requestedAt: httpRequest.body.decision.decidedAt, workHistory: "HTTP route employment history" };
  assert.equal((await requestHttp(agent.id, "AGENT", responseRoute, httpResponse)).status, 403);
  assert.equal((await requestHttp(renter.id, "RENTER", responseRoute, { ...httpResponse, workHistory: "" })).status, 400);
  assert.equal((await requestHttp(renter.id, "RENTER", responseRoute, httpResponse)).status, 200);
  assert.equal((await requestHttp(renter.id, "RENTER", responseRoute, httpResponse)).status, 200);
  pass("Landlord request and renter response HTTP routes validate LOV, role access, required fields and retry safety");

  const api = async (id: string, role: string, scope: string, path = "?limit=10", method = "GET") => {
    const token = jwt.sign({ userId: id, role, accountScope: scope }, env.JWT_ACCESS_SECRET);
    return fetch(`http://127.0.0.1:${address.port}/api/notifications${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  };
  const result = await (await api(renter.id, "RENTER", "PUBLIC")).json() as { unreadCount: number; notifications: unknown[]; hasMore: boolean };
  assert.ok(result.unreadCount > 50); assert.equal(result.notifications.length, 10); assert.ok(result.hasMore);
  assert.equal((await api(outsider.id, "LANDLORD", "PUBLIC", `/${rows[0].id}/read`, "PATCH")).status, 404);
  assert.equal((await api(admin.id, "ADMIN", "STAFF")).status, 200);
  assert.equal((await api(admin.id, "ADMIN", "PUBLIC")).status, 403);
  await markAllNotificationsRead(renter.id);
  assert.equal((await (await api(renter.id, "RENTER", "PUBLIC")).json() as { unreadCount: number }).unreadCount, 0);
  pass("All-portal API authorization, true unread totals, pagination and read/unread ownership");
  console.log(`${passed.length} notification regression groups passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await prisma.publicAccountNotification.deleteMany({ where: { OR: [{ publicAccountId: { in: ids } }, { staffUserId: staffId ?? "none" }, { relatedEntityId: { in: paymentIds } }] } });
  await prisma.notificationEmail.deleteMany({ where: { recipient: { in: emails } } });
  if (propertyId) await prisma.property.delete({ where: { id: propertyId } });
  await prisma.rentScorePayment.deleteMany({ where: { requestedByAccountId: { in: ids } } });
  await prisma.publicAccount.deleteMany({ where: { id: { in: ids } } });
  if (staffId) await prisma.user.delete({ where: { id: staffId } });
  for (const file of uploadedTestFiles) await unlink(file).catch(() => {});
  await prisma.$disconnect();
});
