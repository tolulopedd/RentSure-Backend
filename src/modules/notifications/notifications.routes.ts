import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { requireAuth } from "../../middleware/auth.middleware";
import { requirePublicRole } from "../../middleware/public-role.middleware";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "./notifications.service";

const router = Router();
router.use("/notifications", requireAuth, requirePublicRole("RENTER", "LANDLORD", "AGENT"));

router.get("/notifications", async (req, res, next) => {
  try {
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
    const notifications = await listNotifications(req.user!.userId, limit);
    res.json({ notifications, unreadCount: notifications.filter((item) => !item.readAt).length });
  } catch (error) {
    next(error);
  }
});

router.patch("/notifications/:notificationId/read", async (req, res, next) => {
  try {
    const notificationId = z.string().uuid().parse(req.params.notificationId);
    const result = await markNotificationRead(req.user!.userId, notificationId);
    if (!result.count) throw new AppError("Notification not found", 404, "NOTIFICATION_NOT_FOUND");
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/notifications/read-all", async (req, res, next) => {
  try {
    await markAllNotificationsRead(req.user!.userId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export { router as notificationsRoutes };

