import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { notifyUser } from "../notifications/notifications.service";
type Db = Prisma.TransactionClient | typeof prisma;
export type Actor = { id: string; key: string; scope: "PUBLIC" | "STAFF"; role: string; name: string };
const deny = () => new AppError("Conversation not found or access denied", 404, "CONVERSATION_NOT_FOUND");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function messagingActor(id: string, scope: "PUBLIC" | "STAFF", db: Db = prisma): Promise<Actor> {
  if (scope === "STAFF") {
    const user = await db.user.findUnique({ where: { id } });
    if (!user || user.role !== "ADMIN" || user.status !== "ACTIVE") throw new AppError("Messaging access denied", 403, "FORBIDDEN");
    return { id, key: `STAFF:${id}`, scope, role: "ADMIN", name: user.fullName };
  }
  const account = await db.publicAccount.findUnique({ where: { id } });
  if (!account || !["RENTER", "LANDLORD"].includes(account.accountType) || account.status !== "ACTIVE") throw new AppError("Messaging access denied", 403, "FORBIDDEN");
  return { id, key: `PUBLIC:${id}`, scope, role: account.accountType, name: account.organizationName?.trim() || `${account.firstName} ${account.lastName}`.trim() };
}
async function recipient(actor: Actor, key: string, db: Db = prisma) {
  const [scope, id] = key.split(":");
  if (!id || !["STAFF", "PUBLIC"].includes(scope) || key === actor.key) throw deny();
  const other = await messagingActor(id, scope as Actor["scope"], db);
  if (actor.role === "ADMIN" || other.role === "ADMIN") {
    if (actor.role === other.role) throw deny();
    return other;
  }
  if (actor.role === other.role) throw deny();
  const renter = actor.role === "RENTER" ? actor : other;
  const landlord = actor.role === "LANDLORD" ? actor : other;
  const link = await db.proposedRenter.findFirst({ where: { renterAccountId: renter.id,
    property: { members: { some: { publicAccountId: landlord.id, role: "LANDLORD" } } } }, select: { id: true } });
  if (!link) throw deny();
  return other;
}
export async function messagingRecipients(actor: Actor, q = "") {
  const text = q.trim();
  const results: { key: string; name: string; role: string }[] = [];
  if (actor.role !== "ADMIN") {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE", ...(text ? { fullName: { contains: text, mode: "insensitive" as const } } : {}) }, take: 50, orderBy: { fullName: "asc" } });
    results.push(...admins.map(user => ({ key: `STAFF:${user.id}`, name: user.fullName, role: "ADMIN" })));
  }
  const accounts = await prisma.publicAccount.findMany({ where: { status: "ACTIVE", accountType: { in: actor.role === "ADMIN" ? ["RENTER", "LANDLORD"] : actor.role === "RENTER" ? ["LANDLORD"] : ["RENTER"] },
    ...(text ? { AND: text.split(/\s+/).map(term => ({ OR: ["firstName", "lastName", "organizationName"].map(field => ({ [field]: { contains: term, mode: "insensitive" } })) })) } : {}),
    ...(actor.role === "RENTER" ? { linkedProperties: { some: { role: "LANDLORD", property: { proposedRenters: { some: { renterAccountId: actor.id } } } } } } : {}),
    ...(actor.role === "LANDLORD" ? { linkedRenterCases: { some: { property: { members: { some: { publicAccountId: actor.id, role: "LANDLORD" } } } } } } : {})
  }, take: 50, orderBy: [{ firstName: "asc" }, { id: "asc" }] });
  results.push(...accounts.map(account => ({ key: `PUBLIC:${account.id}`, name: account.organizationName?.trim() || `${account.firstName} ${account.lastName}`, role: account.accountType })));
  return results;
}
async function canSeeProperty(actor: Actor, propertyId: string, db: Db) {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "LANDLORD") return Boolean(await db.propertyMember.findFirst({ where: { propertyId, publicAccountId: actor.id, role: "LANDLORD" } }));
  return Boolean(await db.proposedRenter.findFirst({ where: { propertyId, renterAccountId: actor.id } }));
}
export async function conversationContexts(actor: Actor, recipientKey: string) {
  const other = await recipient(actor, recipientKey);
  const publicActor = actor.role === "ADMIN" ? other : actor;
  const properties = await prisma.property.findMany({ where: publicActor.role === "RENTER"
    ? { proposedRenters: { some: { renterAccountId: publicActor.id } } }
    : { members: { some: { publicAccountId: publicActor.id, role: "LANDLORD" } } },
    include: { proposedRenters: { select: { id: true, renterAccountId: true, decision: true, firstName: true, lastName: true } } }, take: 100, orderBy: { createdAt: "desc" } });
  const contexts: { type: string; id: string; label: string }[] = [];
  for (const property of properties) {
    if (!(await canSeeProperty(other, property.id, prisma))) continue;
    contexts.push({ type: "PROPERTY", id: property.id, label: property.name });
    for (const application of property.proposedRenters) {
      if ([actor, other].some(item => item.role === "RENTER" && application.renterAccountId !== item.id)) continue;
      const label = `${property.name} — ${application.firstName} ${application.lastName}`;
      contexts.push({ type: "APPLICATION", id: application.id, label });
      if (application.decision === "APPROVED") contexts.push({ type: "TENANCY", id: application.id, label });
    }
  }
  return contexts;
}
async function context(actor: Actor, other: Actor, type: string, id: string | undefined, db: Db) {
  if (["NONE", "SUPPORT"].includes(type)) {
    if (id || (type === "SUPPORT" && actor.role !== "ADMIN" && other.role !== "ADMIN")) throw deny();
    return type === "SUPPORT" ? "Support conversation" : null;
  }
  if (!id) throw deny();
  if (type === "PROPERTY") {
    const property = await db.property.findUnique({ where: { id } });
    if (!property || !(await canSeeProperty(actor, id, db)) || !(await canSeeProperty(other, id, db))) throw deny();
    return property.name;
  }
  const application = await db.proposedRenter.findUnique({ where: { id }, include: { property: true } });
  if (!application || (type === "TENANCY" && application.decision !== "APPROVED") || [actor, other].some(item => item.role === "RENTER" && item.id !== application.renterAccountId)) throw deny();
  for (const item of [actor, other]) if (!(await canSeeProperty(item, application.propertyId, db))) throw deny();
  return `${application.property.name} — ${application.firstName} ${application.lastName}`;
}
async function membership(actor: Actor, conversationId: string, db: Db = prisma) {
  const member = await db.conversationParticipant.findUnique({ where: { conversationId_actorKey: { conversationId, actorKey: actor.key } } });
  if (!member) throw deny();
  return member;
}
async function append(actor: Actor, conversationId: string, content: string, clientRequestId: string, db: Db) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hash(`${actor.key}:${clientRequestId}`)}, 0))`;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`conversation:${conversationId}`}, 0))`;
  const member = await membership(actor, conversationId, db);
  const requestKey = hash(`${actor.key}:${clientRequestId}`);
  const existing = await db.conversationMessage.findUnique({ where: { requestKey } });
  if (existing) {
    if (existing.conversationId !== conversationId || existing.content !== content) throw new AppError("Request key already used for another message", 409, "IDEMPOTENCY_CONFLICT");
    return existing;
  }
  const thread = await db.conversation.update({ where: { id: conversationId }, data: { lastSequence: { increment: 1 }, updatedAt: new Date() }, include: { participants: true } });
  const message = await db.conversationMessage.create({ data: { conversationId, senderId: member.id, requestKey, sequence: thread.lastSequence, content } });
  await db.conversationParticipant.updateMany({ where: { conversationId }, data: { archivedAt: null } });
  for (const target of thread.participants.filter(item => item.id !== member.id)) {
    const [scope, id] = target.actorKey.split(":");
    await notifyUser({ db, recipientAccountId: scope === "PUBLIC" ? id : undefined, recipientStaffId: scope === "STAFF" ? id : undefined,
      event: "STAKEHOLDER_UPDATE", eventKey: `message:${message.id}`, title: "New RentSure message",
      message: `${actor.name} sent you a message in “${thread.subject}”. Open the conversation to read and reply.`,
      actionLabel: "Open conversation", actionUrl: `${scope === "STAFF" ? "/app" : "/account"}/messages?conversation=${conversationId}`,
      relatedEntityType: "CONVERSATION", relatedEntityId: conversationId });
  }
  return message;
}
export async function startConversation(actor: Actor, input: { recipientKey: string; subject: string; content: string; clientRequestId: string; contextType: string; contextId?: string }) {
  return prisma.$transaction(async db => {
    const creationKey = hash(`${actor.key}:${input.clientRequestId}`);
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${creationKey}, 0))`;
    const existing = await db.conversation.findUnique({ where: { creationKey }, include: { participants: true, messages: { orderBy: { sequence: "asc" }, take: 1 } } });
    if (existing) {
      if (existing.subject !== input.subject || existing.contextType !== input.contextType || existing.contextId !== (input.contextId ?? null) || existing.messages[0]?.content !== input.content || !existing.participants.some(item => item.actorKey === input.recipientKey)) throw new AppError("Request key already used", 409, "IDEMPOTENCY_CONFLICT");
      return { id: existing.id };
    }
    const other = await recipient(actor, input.recipientKey, db);
    const label = await context(actor, other, input.contextType, input.contextId, db);
    const thread = await db.conversation.create({ data: { creationKey, subject: input.subject, contextType: input.contextType, contextId: input.contextId, contextLabel: label,
      participants: { create: [actor, other].map(item => ({ actorKey: item.key, displayName: item.name, role: item.role })) } } });
    await append(actor, thread.id, input.content, input.clientRequestId, db);
    return { id: thread.id };
  });
}
export async function replyConversation(actor: Actor, id: string, content: string, requestId: string) {
  return prisma.$transaction(db => append(actor, id, content, requestId, db));
}
export async function unreadMessages(actor: Actor) {
  const rows = await prisma.$queryRaw<{ conversationId: string; count: bigint }[]>`
    SELECT p."conversationId", COUNT(m.id) AS count FROM "ConversationParticipant" p
    JOIN "ConversationMessage" m ON m."conversationId" = p."conversationId" AND m.sequence > p."readThrough" AND m."senderId" <> p.id
    WHERE p."actorKey" = ${actor.key} GROUP BY p."conversationId"`;
  return rows.map(row => ({ id: row.conversationId, count: Number(row.count) }));
}
export async function listConversations(actor: Actor, folder: string, q: string, offset: number) {
  const unread = await unreadMessages(actor);
  const where: Prisma.ConversationWhereInput = { participants: { some: { actorKey: actor.key, ...(folder === "ARCHIVED" ? { archivedAt: { not: null } } : { archivedAt: null }) } },
    ...(folder === "UNREAD" ? { id: { in: unread.map(row => row.id) } } : {}),
    ...(folder === "SENT" ? { messages: { some: { sender: { actorKey: actor.key } } } } : {}),
    ...(folder === "INBOX" ? { messages: { some: { sender: { actorKey: { not: actor.key } } } } } : {}),
    ...(q ? { OR: [{ subject: { contains: q, mode: "insensitive" } }, { messages: { some: { content: { contains: q, mode: "insensitive" } } } }, { participants: { some: { displayName: { contains: q, mode: "insensitive" } } } }] } : {}) };
  const [items, total] = await Promise.all([prisma.conversation.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: offset, take: 30,
    include: { participants: true, messages: { orderBy: { sequence: "desc" }, take: 1 } } }), prisma.conversation.count({ where })]);
  return { items: items.map(item => ({ ...item, unreadCount: unread.find(row => row.id === item.id)?.count ?? 0 })), total, unreadCount: unread.reduce((sum, row) => sum + row.count, 0), actorKey: actor.key };
}
export async function conversationHistory(actor: Actor, id: string, after: number) {
  await membership(actor, id);
  const thread = await prisma.conversation.findUniqueOrThrow({ where: { id }, include: { participants: true } });
  const messages = await prisma.conversationMessage.findMany({ where: { conversationId: id, sequence: { gt: after } }, orderBy: { sequence: "asc" }, take: 100 });
  return { ...thread, messages, actorKey: actor.key, hasMore: (messages.at(-1)?.sequence ?? after) < thread.lastSequence };
}
export async function readConversation(actor: Actor, id: string, through: number) {
  const member = await membership(actor, id);
  const thread = await prisma.conversation.findUniqueOrThrow({ where: { id } });
  await prisma.conversationParticipant.updateMany({ where: { id: member.id, readThrough: { lt: Math.min(through, thread.lastSequence) } }, data: { readThrough: Math.min(through, thread.lastSequence) } });
}
export async function archiveConversation(actor: Actor, id: string, archived: boolean) {
  const member = await membership(actor, id);
  await prisma.conversationParticipant.update({ where: { id: member.id }, data: { archivedAt: archived ? new Date() : null } });
}
