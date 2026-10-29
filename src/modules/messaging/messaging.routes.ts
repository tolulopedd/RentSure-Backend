import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.middleware";
import { AppError } from "../../common/errors/AppError";
import * as service from "./messaging.service";
const router = Router();
router.use("/messaging", requireAuth);
const actor = (req: Request) => service.messagingActor(req.user!.userId, req.user!.accountScope ?? "STAFF");
const uuid = z.string().uuid();
const message = z.object({ content: z.string().trim().min(1).max(10000), clientRequestId: uuid });
const create = message.extend({ recipientKey: z.string().regex(/^(PUBLIC|STAFF):[0-9a-f-]{36}$/i), subject: z.string().trim().min(1).max(160),
  contextType: z.enum(["NONE", "PROPERTY", "APPLICATION", "TENANCY", "SUPPORT"]).default("NONE"), contextId: uuid.optional() });
const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: import("express").Response, next: import("express").NextFunction) => {
  try { res.json(await fn(req)); } catch (error) { next(error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? "Invalid request", 400, "VALIDATION_ERROR") : error); }
};
router.get("/messaging/unread", handle(async req => ({ count: (await service.unreadMessages(await actor(req))).reduce((sum, item) => sum + item.count, 0) })));
router.get("/messaging/recipients", handle(async req => ({ items: await service.messagingRecipients(await actor(req), z.string().max(100).default("").parse(req.query.q)) })));
router.get("/messaging/contexts", handle(async req => ({ items: await service.conversationContexts(await actor(req), create.shape.recipientKey.parse(req.query.recipientKey)) })));
router.get("/messaging/conversations", handle(async req => {
  const query = z.object({ folder: z.enum(["INBOX", "SENT", "UNREAD", "ARCHIVED"]).default("INBOX"), q: z.string().max(100).default(""), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
  return service.listConversations(await actor(req), query.folder, query.q, query.offset);
}));
router.post("/messaging/conversations", handle(async req => service.startConversation(await actor(req), create.parse(req.body))));
router.get("/messaging/conversations/:id", handle(async req => service.conversationHistory(await actor(req), uuid.parse(req.params.id), z.coerce.number().int().min(0).default(0).parse(req.query.after))));
router.post("/messaging/conversations/:id/messages", handle(async req => { const body = message.parse(req.body); return service.replyConversation(await actor(req), uuid.parse(req.params.id), body.content, body.clientRequestId); }));
router.patch("/messaging/conversations/:id/read", handle(async req => { await service.readConversation(await actor(req), uuid.parse(req.params.id), z.object({ through: z.number().int().min(0) }).parse(req.body).through); return { success: true }; }));
router.patch("/messaging/conversations/:id/archive", handle(async req => { await service.archiveConversation(await actor(req), uuid.parse(req.params.id), z.object({ archived: z.boolean() }).parse(req.body).archived); return { success: true }; }));
export { router as messagingRoutes };
