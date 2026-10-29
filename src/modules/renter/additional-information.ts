import { z } from "zod";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { buildPublicDocumentViewUrl } from "../storage/storage.service";
import { notifyUser } from "../notifications/notifications.service";

export const informationResponseSchema = z.object({
  requestedAt: z.string().datetime(),
  workHistory: z.string().trim().min(1).max(10000).optional(),
  referenceLetter: z.object({
    objectKey: z.string().max(1000),
    fileName: z.string().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    fileSize: z.number().int().positive().max(5 * 1024 * 1024)
  }).optional()
});
export function informationResponseView(value: unknown) {
  const parsed = informationResponseSchema.extend({ submittedAt: z.string().datetime() }).safeParse(value);
  if (!parsed.success) return null;
  const response = parsed.data;
  return { ...response, referenceLetter: response.referenceLetter ? {
    ...response.referenceLetter, url: buildPublicDocumentViewUrl(response.referenceLetter.objectKey)
  } : null };
}
export async function submitAdditionalInformation(accountId: string, caseId: string, input: z.infer<typeof informationResponseSchema>) {
  input = informationResponseSchema.parse(input);
  return prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"additional-information:" + caseId}, 0))`;
    const account = await db.publicAccount.findUnique({ where: { id: accountId } });
    if (!account || account.accountType !== "RENTER" || account.status !== "ACTIVE") throw new AppError("Access denied", 403, "FORBIDDEN");
    const item = await db.proposedRenter.findFirst({ where: { id: caseId, renterAccountId: accountId }, include: { property: true } });
    if (!item) throw new AppError("Application not found", 404, "NOT_FOUND");
    if (item.decision !== "HOLD" || item.decisionAt?.toISOString() !== input.requestedAt || !item.requestedInformation.length) {
      throw new AppError("This request has changed. Refresh the application before submitting.", 409, "REQUEST_CHANGED");
    }
    const wantsHistory = item.requestedInformation.includes("Work History");
    const wantsLetter = item.requestedInformation.includes("Work Reference Letter");
    if (wantsHistory !== Boolean(input.workHistory) || wantsLetter !== Boolean(input.referenceLetter)) throw new AppError("Provide each requested item", 400, "VALIDATION_ERROR");
    if (input.referenceLetter) {
      const key = input.referenceLetter.objectKey.replace(/^local\//, "");
      if (!key.startsWith(`public-accounts/${accountId}/employment_document/`) ||
          key.split("/").some(part => part === "." || part === "..") || key.includes("\\") || key.includes("%")) {
        throw new AppError("Attach a work reference letter uploaded by your account", 400, "INVALID_DOCUMENT");
      }
    }
    // One immutable response per request; a transport retry cannot duplicate notifications.
    if (item.additionalInformationResponse) return { success: true };
    const response = { ...input, submittedAt: new Date().toISOString() };
    await db.proposedRenter.update({ where: { id: caseId }, data: { additionalInformationResponse: response } });
    await db.proposedRenterActivity.create({ data: { proposedRenterId: caseId, actorAccountId: accountId,
      activityType: "COMMENT", message: `Renter provided the requested information: ${item.requestedInformation.join(", ")}.`,
      metadata: { additionalInformationSubmitted: true, requestedAt: input.requestedAt, requestedInformation: item.requestedInformation, response } } });
    if (item.decisionByAccountId) await notifyUser({ db, recipientAccountId: item.decisionByAccountId,
      event: "STAKEHOLDER_UPDATE", eventKey: `additional-information:${caseId}:${input.requestedAt}`,
      title: "Requested renter information submitted",
      message: `${item.property.name}: The renter provided ${item.requestedInformation.join(", ")}. Review the submission and continue your application decision.`,
      actionUrl: `/account/decisions?caseId=${caseId}`, actionLabel: "Review information",
      relatedEntityType: "PROPOSED_RENTER", relatedEntityId: caseId });
    return { success: true };
  });
}
