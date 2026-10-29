import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Server } from "node:http";
import { prisma } from "../prisma/client";
import { env } from "../config/env";
import { createApp } from "../app";
import { deliverNotificationEmails } from "../modules/notifications/notification-email.service";

const accounts: string[] = [], staff: string[] = [], conversations: string[] = [];
let propertyId: string | undefined, server: Server | undefined;
let groups = 0;
const pass = (label: string) => { groups++; console.log("PASS " + label); };
type Identity = { id: string; role: string; scope: string };
async function account(role: "RENTER" | "LANDLORD" | "AGENT") {
  const row = await prisma.publicAccount.create({ data: { accountType: role, entityType: "INDIVIDUAL", firstName: "Messaging", lastName: role,
    email: `messaging-${randomUUID()}@example.com`, passwordHash: "test-only", phone: "09000000000", state: "Lagos", city: "Ikeja", address: "Test Street", status: "ACTIVE", acceptedTermsAt: new Date(), emailVerifiedAt: new Date() } });
  accounts.push(row.id); return { ...row, role, scope: "PUBLIC" };
}
async function main() {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname));
  assert.equal(Boolean(env.RESEND_API_KEY), false, "Disable live email for test fixtures");
  const renter = await account("RENTER"), landlord = await account("LANDLORD"), outsider = await account("LANDLORD"), agent = await account("AGENT");
  const admins: Identity[] = [];
  for (let i = 0; i < 2; i++) {
    const row = await prisma.user.create({ data: { fullName: "Messaging Admin", email: `messaging-${randomUUID()}@example.com`, passwordHash: "test-only", role: "ADMIN", adminRole: "ADMIN" } });
    staff.push(row.id); admins.push({ id: row.id, role: "ADMIN", scope: "STAFF" });
  }
  const admin = admins[0];
  const property = await prisma.property.create({ data: { name: "Messaging test property", ownerName: "Test", landlordEmail: landlord.email, address: "Test Street", state: "Lagos", city: "Ikeja", propertyType: "Flats", createdByAccountId: landlord.id,
    units: { create: { label: "Unit 1", address: "Test Street", state: "Lagos", city: "Ikeja", bedroomCount: 1, bathroomCount: 1, annualRentAmountNgn: 1200000 } } }, include: { units: true } });
  propertyId = property.id;
  await prisma.propertyMember.create({ data: { propertyId, publicAccountId: landlord.id, role: "LANDLORD", isPrimary: true } });
  const application = await prisma.proposedRenter.create({ data: { propertyId, propertyUnitId: property.units[0].id, renterAccountId: renter.id, requestedByAccountId: landlord.id,
    firstName: renter.firstName, lastName: renter.lastName, email: renter.email, phone: renter.phone, address: renter.address, city: renter.city, state: renter.state, decision: "APPROVED" } });
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const key = (person: Identity) => `${person.scope}:${person.id}`;
  async function api(person: Identity, path: string, method = "GET", body?: unknown, status = 200): Promise<any> {
    const token = jwt.sign({ userId: person.id, role: person.role, accountScope: person.scope }, env.JWT_ACCESS_SECRET);
    const response = await fetch(`http://127.0.0.1:${port}/api/messaging${path}`, { method, headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
  }
  const input = (to: Identity, extra = {}) => ({ recipientKey: key(to), subject: "Test conversation", content: "Initial message", clientRequestId: randomUUID(), ...extra });
  const reply = (content: string) => ({ content, clientRequestId: randomUUID() });
  for (const [from, to] of [[renter, landlord], [landlord, renter], [renter, admin], [admin, renter], [landlord, admin], [admin, landlord]]) {
    const body = input(to);
    const created = await api(from, "/conversations", "POST", body); conversations.push(created.id);
    await api(to, `/conversations/${created.id}/messages`, "POST", reply("Reply from recipient"));
    const history = await api(from, `/conversations/${created.id}`);
    assert.deepEqual(history.messages.map((m: any) => m.sequence), [1, 2]);
    assert.equal(history.participants.length, 2);
    assert.ok(history.messages.every((m: any) => m.createdAt && history.participants.some((p: any) => p.id === m.senderId)));
    const notes = await prisma.publicAccountNotification.findMany({ where: { relatedEntityId: created.id }, include: { emailDelivery: true } });
    assert.equal(notes.length, 2);
    assert.deepEqual(notes.map(n => n.publicAccountId ?? n.staffUserId).sort(), [from.id, to.id].sort());
    for (const note of notes) {
      assert.ok(note.emailDelivery); assert.ok(note.ctaPath?.endsWith(`messages?conversation=${created.id}`));
      assert.ok(note.emailDelivery!.html.includes(created.id));
      assert.ok(!note.emailDelivery!.html.includes("Reply from recipient"));
    }
  }
  pass("All six stakeholder directions: persistent chronological replies, exact recipients, in-app and queued email deep links");
  const id = conversations[0];
  const recipientList = await api(renter, "/recipients");
  assert.ok(recipientList.items.some((r: any) => r.key === key(landlord)));
  assert.ok(!recipientList.items.some((r: any) => r.key === key(outsider)));
  for (const query of ["Messaging LANDLORD", "landlord messaging"]) {
    const matching = await api(renter, "/recipients?q=" + encodeURIComponent(query));
    assert.ok(matching.items.some((r: any) => r.key === key(landlord) && r.role === "LANDLORD"));
    assert.ok(!matching.items.some((r: any) => r.key === key(outsider)));
  }

  for (const person of [outsider, admins[1]]) {
    await api(person, `/conversations/${id}`, "GET", undefined, 404);
    await api(person, `/conversations/${id}/messages`, "POST", reply("Forbidden"), 404);
    await api(person, `/conversations/${id}/read`, "PATCH", { through: 99 }, 404);
    await api(person, `/conversations/${id}/archive`, "PATCH", { archived: true }, 404);
  }
  await api(agent, "/conversations", "GET", undefined, 403);
  await api(renter, "/conversations", "POST", input(outsider), 404);
  await api(renter, "/conversations", "POST", input(renter), 404);
  await api(admin, "/conversations", "POST", input(admins[1]), 404);
  pass("Participant-only history/replies/read/archive, recipient eligibility and Agent exclusion");
  const contexts = await api(renter, "/contexts?recipientKey=" + encodeURIComponent(key(landlord)));
  for (const type of ["PROPERTY", "APPLICATION", "TENANCY"]) {
    assert.ok(contexts.items.some((c: any) => c.type === type));
    const created = await api(renter, "/conversations", "POST", input(landlord, { contextType: type, contextId: type === "PROPERTY" ? propertyId : application.id })); conversations.push(created.id);
  }
  await api(renter, "/conversations", "POST", input(landlord, { contextType: "PROPERTY", contextId: randomUUID() }), 404);
  await api(outsider, "/conversations", "POST", input(admin, { contextType: "PROPERTY", contextId: propertyId }), 404);
  await api(renter, "/conversations", "POST", input(landlord, { contextType: "SUPPORT" }), 404);
  const support = await api(renter, "/conversations", "POST", input(admin, { contextType: "SUPPORT" })); conversations.push(support.id);
  pass("Property/application/tenancy contexts and Admin support enforce shared access");
  const duplicate = input(landlord, { subject: "Idempotency needle" });
  const results = await Promise.all([api(renter, "/conversations", "POST", duplicate), api(renter, "/conversations", "POST", duplicate)]);
  assert.equal(results[0].id, results[1].id); const duplicateId = results[0].id; conversations.push(duplicateId);
  const repeatedReply = reply("Concurrent reply");
  await Promise.all([api(landlord, `/conversations/${duplicateId}/messages`, "POST", repeatedReply), api(landlord, `/conversations/${duplicateId}/messages`, "POST", repeatedReply)]);
  assert.equal(await prisma.conversationMessage.count({ where: { conversationId: duplicateId } }), 2);
  assert.equal(await prisma.publicAccountNotification.count({ where: { relatedEntityId: duplicateId } }), 2);
  await api(renter, "/conversations", "POST", { ...duplicate, content: "Changed" }, 409);
  await api(landlord, `/conversations/${duplicateId}/messages`, "POST", { ...repeatedReply, content: "Changed" }, 409);
  pass("Concurrent create/reply retries produce one message and notification; conflicting reuse rejected");
  const list = await api(renter, "/conversations?folder=SENT&q=needle");
  assert.equal(list.total, 1); assert.equal(list.items[0].id, duplicateId);
  assert.ok((await api(renter, "/conversations?folder=INBOX")).items.some((c: any) => c.id === duplicateId));
  assert.ok((await api(renter, "/conversations?folder=UNREAD")).items.some((c: any) => c.id === duplicateId));
  await api(renter, `/conversations/${duplicateId}/read`, "PATCH", { through: 2 });
  await api(landlord, `/conversations/${duplicateId}/messages`, "POST", reply("Arrived after read"));
  await api(renter, `/conversations/${duplicateId}/read`, "PATCH", { through: 1 });
  let thread = await api(renter, `/conversations/${duplicateId}`);
  assert.equal(thread.participants.find((p: any) => p.actorKey === key(renter)).readThrough, 2);
  assert.equal((await api(renter, "/conversations?q=needle")).items[0].unreadCount, 1);
  await api(renter, `/conversations/${duplicateId}/archive`, "PATCH", { archived: true });
  assert.equal((await api(renter, "/conversations?folder=ARCHIVED&q=needle")).total, 1);
  assert.equal((await api(landlord, "/conversations?folder=ARCHIVED&q=needle")).total, 0);
  await api(renter, `/conversations/${duplicateId}/archive`, "PATCH", { archived: false });
  await api(renter, `/conversations/${duplicateId}/archive`, "PATCH", { archived: true });
  await api(landlord, `/conversations/${duplicateId}/messages`, "POST", reply("Reopens archived conversation"));
  assert.equal((await api(renter, "/conversations?folder=ARCHIVED&q=needle")).total, 0);
  assert.equal((await api(renter, `/conversations/${duplicateId}`)).messages.length, 4);
  pass("Inbox/Sent/Unread/search, monotonic read cursor, per-user archive/reopen and complete retained history");
  const member = await prisma.conversationParticipant.findFirstOrThrow({ where: { conversationId: id, actorKey: key(landlord) } });
  await prisma.$transaction(async db => {
    await db.conversationMessage.createMany({ data: Array.from({ length: 101 }, (_, i) => ({ conversationId: id, senderId: member.id, requestKey: randomUUID(), sequence: i + 3, content: "Pagination fixture" })) });
    await db.conversation.update({ where: { id }, data: { lastSequence: 103 } });
  });
  thread = await api(renter, `/conversations/${id}`);
  assert.equal(thread.messages.length, 100); assert.ok(thread.hasMore);
  const next = await api(renter, `/conversations/${id}?after=100`);
  assert.deepEqual(next.messages.map((m: any) => m.sequence), [101,102,103]); assert.equal(next.hasMore, false);
  assert.ok((await api(renter, "/unread")).count >= 102);
  pass("Chronological pagination and unread totals beyond page size");
  await api(renter, "/conversations", "POST", input(landlord, { content: " " }), 400);
  await api(renter, "/conversations", "POST", input(landlord, { content: "x".repeat(10001) }), 400);
  await prisma.publicAccount.update({ where: { id: renter.id }, data: { status: "SUSPENDED" } });
  await api(renter, "/conversations", "GET", undefined, 403);
  await prisma.publicAccount.update({ where: { id: renter.id }, data: { status: "ACTIVE" } });
  pass("Payload validation and active-account authorization despite existing token");
  const note = await prisma.publicAccountNotification.findFirstOrThrow({ where: { relatedEntityId: duplicateId }, include: { emailDelivery: true } });
  const job = note.emailDelivery!;
  await deliverNotificationEmails(async () => { throw new Error("Simulated provider outage"); }, [job.id]);
  assert.equal((await prisma.notificationEmail.findUniqueOrThrow({ where: { id: job.id } })).deliveredAt, null);
  assert.equal((await api(renter, `/conversations/${duplicateId}`)).messages.length, 4);
  await prisma.notificationEmail.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
  let deliveries = 0;
  await deliverNotificationEmails(async () => { deliveries++; return { deliveryMode: "RESEND", previewUrl: null }; }, [job.id]);
  await deliverNotificationEmails(async () => { deliveries++; return { deliveryMode: "RESEND", previewUrl: null }; }, [job.id]);
  assert.equal(deliveries, 1);
  pass("Email outage preserves messages and in-app notification; queued retry delivers once (simulated)");
  console.log(`${groups} messaging regression groups passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  // Include fixture-owned threads even if an assertion interrupted tracking their IDs.
  const rows = await prisma.conversation.findMany({ where: { participants: { some: { actorKey: { in: [...accounts.map(id => "PUBLIC:" + id), ...staff.map(id => "STAFF:" + id)] } } } }, select: { id: true } });
  const ids = rows.map(row => row.id);
  await prisma.publicAccountNotification.deleteMany({ where: { relatedEntityId: { in: ids } } });
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  if (propertyId) await prisma.property.delete({ where: { id: propertyId } });
  await prisma.publicAccount.deleteMany({ where: { id: { in: accounts } } });
  await prisma.user.deleteMany({ where: { id: { in: staff } } });
  await prisma.$disconnect();
});
