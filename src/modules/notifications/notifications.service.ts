import { createHash, randomUUID } from "node:crypto";
import { PublicNotificationType, type Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { env } from "../../config/env";
import { renderTransactionalEmail } from "../mail/mail-templates";
import { queueTransactionalMail, type NotificationDb } from "./notification-email.service";

export type NotifyUserInput = {
  recipientAccountId?: string;
  recipientStaffId?: string;
  event: PublicNotificationType | string;
  eventKey?: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  metadata?: Prisma.JsonObject;
  sendEmail?: boolean;
  db?: NotificationDb;
};
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function notificationPath(path?: string | null, staff = false) {
  // Notification CTAs stay in this app; never follow user-supplied external URLs.
  return path?.startsWith("/") && !path.startsWith("//") && !path.includes("\\")
    ? path : staff ? "/app/notifications" : "/account/notifications";
}
export async function notifyUser(input: NotifyUserInput) {
  if (Boolean(input.recipientAccountId) === Boolean(input.recipientStaffId)) throw new Error("One notification recipient is required");
  const run = async (db: NotificationDb) => {
    const recipient = input.recipientStaffId
      ? await db.user.findUnique({ where: { id: input.recipientStaffId }, select: { id: true, email: true } })
      : await db.publicAccount.findUnique({ where: { id: input.recipientAccountId! }, select: { id: true, email: true } });
    if (!recipient) return null;
    const path = notificationPath(input.actionUrl, Boolean(input.recipientStaffId));
    const eventKey = input.eventKey ? createHash("sha256").update(`${input.recipientStaffId ? "staff" : "public"}:${recipient.id}:${input.eventKey}`).digest("hex") : undefined;
    if (eventKey) await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${eventKey}, 0))`;
    const data = {
      publicAccountId: input.recipientAccountId ?? null, staffUserId: input.recipientStaffId ?? null, eventKey,
      notificationType: Object.values(PublicNotificationType).includes(input.event as PublicNotificationType) ? input.event as PublicNotificationType : PublicNotificationType.STAKEHOLDER_UPDATE,
      title: input.title, message: input.message, ctaLabel: input.actionLabel ?? "Open RentSure", ctaPath: path,
      relatedEntityType: input.relatedEntityType, relatedEntityId: input.relatedEntityId, metadata: input.metadata
    };
    const notification = eventKey
      ? await db.publicAccountNotification.upsert({ where: { eventKey }, create: data, update: {} })
      : await db.publicAccountNotification.create({ data });
    if (input.sendEmail !== false) {
      await queueTransactionalMail({ db, notificationId: notification.id, dedupeKey: `notification:${notification.id}`,
        category: "NOTIFICATION", to: recipient.email, subject: input.title,
        html: renderTransactionalEmail({ eyebrow: "RentSure Notification", title: input.title,
          paragraphs: [escape(input.message)], ctaLabel: input.actionLabel ?? "Open RentSure",
          ctaUrl: escape(`${env.APP_WEB_BASE_URL.replace(/\/+$/, "")}${path}`) }) });
    }
    return notification;
  };
  return input.db ? run(input.db) : prisma.$transaction(run);
}

// Bulk policy announcements avoid one transaction round trip per renter.
export async function notifyActiveRenters(input: { db: NotificationDb; eventKey: string; title: string; message: string; actionUrl: string }) {
  let cursor: string | undefined;
  for (;;) {
    const accounts = await input.db.publicAccount.findMany({ where: { accountType: "RENTER", status: "ACTIVE" },
      select: { id: true, email: true }, orderBy: { id: "asc" }, take: 250, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!accounts.length) break;
    const rows = accounts.map(account => ({ id: randomUUID(), publicAccountId: account.id,
      eventKey: createHash("sha256").update(`public:${account.id}:${input.eventKey}`).digest("hex"),
      notificationType: PublicNotificationType.STAKEHOLDER_UPDATE, title: input.title, message: input.message,
      ctaLabel: "View Rent Score", ctaPath: input.actionUrl }));
    await input.db.publicAccountNotification.createMany({ data: rows, skipDuplicates: true });
    const persisted = await input.db.publicAccountNotification.findMany({ where: { eventKey: { in: rows.map(row => row.eventKey) } }, select: { id: true, publicAccountId: true } });
    const emails = new Map(accounts.map(account => [account.id, account.email]));
    const html = renderTransactionalEmail({ title: input.title, paragraphs: [escape(input.message)], ctaLabel: "View Rent Score",
      ctaUrl: escape(`${env.APP_WEB_BASE_URL.replace(/\/+$/, "")}${notificationPath(input.actionUrl)}`) });
    await input.db.notificationEmail.createMany({ data: persisted.map(row => ({ id: randomUUID(), notificationId: row.id,
      dedupeKey: `notification:${row.id}`, recipient: emails.get(row.publicAccountId!)!, subject: input.title, html, category: "NOTIFICATION" })), skipDuplicates: true });
    cursor = accounts[accounts.length - 1].id;
  }
}

export async function notifyAdmins(input: Omit<NotifyUserInput, "recipientAccountId" | "recipientStaffId">) {
  const db = input.db ?? prisma;
  const admins = await db.user.findMany({ where: { role: "ADMIN", status: "ACTIVE", OR: [{ adminRole: { in: ["SUPER_ADMIN", "ADMIN"] } }, { adminRole: null }] }, select: { id: true } });
  for (const admin of admins) await notifyUser({ ...input, recipientStaffId: admin.id, db });
}

export function notificationOwner(id: string, scope: "PUBLIC" | "STAFF" = "PUBLIC") {
  return scope === "STAFF" ? { staffUserId: id } : { publicAccountId: id };
}
export async function listNotifications(id: string, limit = 50, scope: "PUBLIC" | "STAFF" = "PUBLIC", offset = 0) {
  return prisma.publicAccountNotification.findMany({ where: notificationOwner(id, scope),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Math.min(Math.max(limit, 1), 100), skip: offset });
}
export async function markNotificationRead(id: string, notificationId: string, scope: "PUBLIC" | "STAFF" = "PUBLIC", read = true) {
  return prisma.publicAccountNotification.updateMany({ where: { id: notificationId, ...notificationOwner(id, scope) }, data: { readAt: read ? new Date() : null } });
}
export async function markAllNotificationsRead(id: string, scope: "PUBLIC" | "STAFF" = "PUBLIC") {
  return prisma.publicAccountNotification.updateMany({ where: { ...notificationOwner(id, scope), readAt: null }, data: { readAt: new Date() } });
}
