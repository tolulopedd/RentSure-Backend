import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { prisma } from "../../prisma/client";
import { requireAuth } from "../../middleware/auth.middleware";
import { listNotifications, markAllNotificationsRead, markNotificationRead, notificationOwner } from "./notifications.service";

const router = Router();
router.use("/notifications", requireAuth, (req, _res, next) => {
  const allowed = req.user?.accountScope === "PUBLIC"
    ? ["RENTER", "LANDLORD", "AGENT"].includes(req.user.role)
    : req.user?.role === "ADMIN";
  next(allowed ? undefined : new AppError("Notification access denied", 403, "FORBIDDEN"));
});
router.get("/notifications", async (req, res, next) => {
  try {
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
    const offset = z.coerce.number().int().min(0).default(0).parse(req.query.offset);
    const scope = req.user!.accountScope;
    const where = notificationOwner(req.user!.userId, scope);
    const [notifications, unreadCount, totalCount] = await Promise.all([
      listNotifications(req.user!.userId, limit, scope, offset),
      prisma.publicAccountNotification.count({ where: { ...where, readAt: null } }),
      prisma.publicAccountNotification.count({ where })
    ]);
    res.json({ notifications, unreadCount, totalCount, hasMore: offset + notifications.length < totalCount });
  } catch (error) { next(error); }
});
for (const state of ["read", "unread"] as const) {
  router.patch(`/notifications/:notificationId/${state}`, async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.notificationId);
      const result = await markNotificationRead(req.user!.userId, id, req.user!.accountScope, state === "read");
      if (!result.count) throw new AppError("Notification not found", 404, "NOTIFICATION_NOT_FOUND");
      res.json({ success: true });
    } catch (error) { next(error); }
  });
}
router.post("/notifications/read-all", async (req, res, next) => {
  try { await markAllNotificationsRead(req.user!.userId, req.user!.accountScope); res.json({ success: true }); }
  catch (error) { next(error); }
});
export { router as notificationsRoutes };
