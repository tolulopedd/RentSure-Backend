import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { logger } from "../../common/logger/logger";
import { createMailPreview } from "../mail-preview/mail-preview.service";
import { sendTransactionalMail } from "../mail/mail.service";

export type NotificationDb = typeof prisma | Prisma.TransactionClient;
type MailInput = Parameters<typeof sendTransactionalMail>[0];

// Queue with the business transaction. The worker only sees committed rows.
export async function queueTransactionalMail(input: MailInput & {
  db?: NotificationDb; notificationId?: string; dedupeKey?: string;
}): Promise<{ deliveryMode: "QUEUED"; previewUrl: string | null }> {
  if (!input.db) return prisma.$transaction(db => queueTransactionalMail({ ...input, db }));
  const db = input.db;
  if (input.dedupeKey) await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.dedupeKey}, 0))`;
  const data = { recipient: input.to, subject: input.subject, html: input.html,
    category: input.category, notificationId: input.notificationId, dedupeKey: input.dedupeKey };
  if (input.dedupeKey) {
    await db.notificationEmail.upsert({ where: { dedupeKey: input.dedupeKey }, create: data, update: {} });
  } else {
    await db.notificationEmail.create({ data });
  }
  const preview = process.env.NODE_ENV === "production" ? null : createMailPreview(input);
  return { deliveryMode: "QUEUED" as const, previewUrl: preview?.previewUrl ?? null };
}

export async function deliverNotificationEmails(send: typeof sendTransactionalMail = sendTransactionalMail, jobIds?: string[]) {
  const now = new Date();
  const jobs = await prisma.notificationEmail.findMany({
    where: { ...(jobIds ? { id: { in: jobIds } } : {}), deliveredAt: null, availableAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    orderBy: { createdAt: "asc" }, take: 25
  });
  for (const job of jobs) {
    const lockToken = randomUUID();
    const claim = await prisma.notificationEmail.updateMany({
      where: { id: job.id, deliveredAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
      data: { lockedUntil: new Date(Date.now() + 120_000), lockToken, attempts: { increment: 1 } }
    });
    if (!claim.count) continue;
    try {
      await send({ category: job.category as MailInput["category"], to: job.recipient,
        subject: job.subject, html: job.html, idempotencyKey: `notification-${job.id}` });
      await prisma.notificationEmail.updateMany({ where: { id: job.id, lockToken },
        data: { deliveredAt: new Date(), lockedUntil: null, lockToken: null, lastError: null } });
    } catch (error) {
      // Keep retries durable; no provider error can roll back a stakeholder action.
      await prisma.notificationEmail.updateMany({ where: { id: job.id, lockToken }, data: {
        lockedUntil: null, lockToken: null, lastError: error instanceof Error ? error.message : String(error),
        availableAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(job.attempts, 7)))
      } });
      logger.error({ event: "notification.email_failed", deliveryId: job.id }, "Notification email will be retried");
    }
  }
}

export function startNotificationEmailWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await deliverNotificationEmails(); }
    catch (error) { logger.error({ err: error }, "Notification email worker failed"); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 10_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
