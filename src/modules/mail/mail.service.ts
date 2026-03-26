import { env } from "../../config/env";
import { logger } from "../../common/logger/logger";
import { createMailPreview } from "../mail-preview/mail-preview.service";

type MailCategory =
  | "EMAIL_VERIFICATION"
  | "RENTER_INVITE"
  | "RENTER_NOTIFICATION"
  | "RENTER_SHARE_REPORT"
  | "PASSWORD_RESET";

function hasResendConfig() {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
}

export async function sendTransactionalMail(input: {
  category: MailCategory;
  to: string;
  subject: string;
  html: string;
}) {
  const preview = createMailPreview({
    category: input.category,
    to: input.to,
    subject: input.subject,
    html: input.html
  });

  if (!hasResendConfig()) {
    logger.info(
      {
        event: "mail.preview_only",
        category: input.category,
        to: input.to,
        previewUrl: preview.previewUrl
      },
      "Transactional email captured as preview"
    );

    return {
      deliveryMode: "PREVIEW_ONLY" as const,
      previewUrl: preview.previewUrl
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(env.RESEND_REPLY_TO ? { reply_to: env.RESEND_REPLY_TO } : {})
    })
  });

  const raw = await response.text();
  let payload: unknown = null;

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = raw;
  }

  if (!response.ok) {
    logger.error(
      {
        event: "mail.resend_failed",
        category: input.category,
        to: input.to,
        status: response.status,
        payload
      },
      "Resend email delivery failed"
    );

    throw new Error("Unable to send email right now. Please try again.");
  }

  logger.info(
    {
      event: "mail.resend_sent",
      category: input.category,
      to: input.to,
      previewUrl: preview.previewUrl
    },
    "Transactional email sent through Resend"
  );

  return {
    deliveryMode: "RESEND" as const,
    previewUrl: process.env.NODE_ENV === "production" ? null : preview.previewUrl
  };
}
