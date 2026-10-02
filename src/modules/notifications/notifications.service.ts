import type { Prisma, PublicNotificationType } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { logger } from "../../common/logger/logger";
import { env } from "../../config/env";
import { renderTransactionalEmail } from "../mail/mail-templates";
import { sendTransactionalMail } from "../mail/mail.service";

type NotificationDb = typeof prisma | Prisma.TransactionClient;

export type NotifyUserInput = {
  recipientAccountId: string;
  event: PublicNotificationType | string;
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

function absoluteUrl(path?: string | null) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${env.APP_WEB_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function notifyUser(input: NotifyUserInput) {
  const db = input.db ?? prisma;
  const recipient = await db.publicAccount.findUnique({
    where: { id: input.recipientAccountId },
    select: { id: true, email: true, firstName: true, lastName: true, organizationName: true }
  });

  if (!recipient) return null;

  const notification = await db.publicAccountNotification.create({
    data: {
      publicAccountId: recipient.id,
      notificationType: input.event as PublicNotificationType,
      title: input.title,
      message: input.message,
      ctaLabel: input.actionLabel ?? null,
      ctaPath: input.actionUrl ?? null,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      metadata: input.metadata
    }
  });

  if (input.sendEmail !== false) {
    const recipientName = recipient.organizationName?.trim() || `${recipient.firstName} ${recipient.lastName}`.trim() || "there";
    void sendTransactionalMail({
      category: "NOTIFICATION",
      to: recipient.email,
      subject: input.title,
      html: renderTransactionalEmail({
        eyebrow: "RentSure Notification",
        title: input.title,
        greeting: `Dear ${recipientName},`,
        paragraphs: [input.message],
        ctaLabel: input.actionLabel ?? "Open RentSure",
        ctaUrl: absoluteUrl(input.actionUrl) ?? env.APP_WEB_BASE_URL
      })
    }).catch((error: unknown) => {
      logger.error({ event: "notification.email_failed", notificationId: notification.id, recipient: recipient.email, error: error instanceof Error ? error.message : String(error) }, "Notification email delivery failed");
    });
  }

  return notification;
}

export async function listNotifications(publicAccountId: string, limit = 50) {
  return prisma.publicAccountNotification.findMany({
    where: { publicAccountId },
    orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(limit, 1), 100)
  });
}

export async function markNotificationRead(publicAccountId: string, notificationId: string) {
  return prisma.publicAccountNotification.updateMany({
    where: { id: notificationId, publicAccountId },
    data: { readAt: new Date() }
  });
}

export async function markAllNotificationsRead(publicAccountId: string) {
  return prisma.publicAccountNotification.updateMany({
    where: { publicAccountId, readAt: null },
    data: { readAt: new Date() }
  });
}

