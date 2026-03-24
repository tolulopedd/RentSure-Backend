import crypto from "crypto";
import { env } from "../../config/env";

type MailPreviewCategory =
  | "EMAIL_VERIFICATION"
  | "RENTER_INVITE"
  | "RENTER_NOTIFICATION"
  | "RENTER_SHARE_REPORT"
  | "PASSWORD_RESET";

type MailPreviewRecord = {
  id: string;
  category: MailPreviewCategory;
  to: string;
  subject: string;
  html: string;
  createdAt: string;
};

const previewStore: MailPreviewRecord[] = [];
const maxPreviewCount = 150;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function apiBaseUrl() {
  if (env.APP_API_BASE_URL?.trim()) {
    return env.APP_API_BASE_URL.replace(/\/+$/, "");
  }

  return `http://localhost:${env.PORT}`;
}

function previewUrl(id: string) {
  return `${apiBaseUrl()}/api/dev/mail-previews/${encodeURIComponent(id)}`;
}

export function createMailPreview(input: {
  category: MailPreviewCategory;
  to: string;
  subject: string;
  html: string;
}) {
  const record: MailPreviewRecord = {
    id: crypto.randomUUID(),
    category: input.category,
    to: input.to.trim().toLowerCase(),
    subject: input.subject.trim(),
    html: input.html,
    createdAt: new Date().toISOString()
  };

  previewStore.unshift(record);
  if (previewStore.length > maxPreviewCount) {
    previewStore.length = maxPreviewCount;
  }

  return {
    ...record,
    previewUrl: previewUrl(record.id)
  };
}

export function listMailPreviews(input?: {
  email?: string;
  category?: MailPreviewCategory;
  limit?: number;
}) {
  const email = input?.email?.trim().toLowerCase();
  const limit = Math.max(1, Math.min(input?.limit ?? 20, 50));

  const items = previewStore
    .filter((item) => (!email || item.to === email) && (!input?.category || item.category === input.category))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      category: item.category,
      to: item.to,
      subject: item.subject,
      createdAt: item.createdAt,
      previewUrl: previewUrl(item.id)
    }));

  return { items };
}

export function getMailPreview(id: string) {
  return previewStore.find((item) => item.id === id) || null;
}

export function renderMailPreviewDocument(record: MailPreviewRecord) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(record.subject)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      .frame { max-width: 840px; margin: 32px auto; padding: 0 20px; }
      .meta, .content { border: 1px solid #dbe4f3; border-radius: 20px; background: white; box-shadow: 0 12px 40px -28px rgba(15, 23, 42, 0.25); }
      .meta { padding: 20px 24px; margin-bottom: 20px; }
      .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
      .label { font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #2563eb; }
      .value { margin-top: 6px; font-size: 14px; color: #334155; word-break: break-word; }
      .content { padding: 24px; }
      @media (max-width: 720px) { .meta-grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="meta">
        <div class="label">RentSure Mail Preview</div>
        <h1 style="margin: 10px 0 0; font-size: 28px;">${escapeHtml(record.subject)}</h1>
        <div class="meta-grid">
          <div>
            <div class="label">To</div>
            <div class="value">${escapeHtml(record.to)}</div>
          </div>
          <div>
            <div class="label">Category</div>
            <div class="value">${escapeHtml(record.category.replaceAll("_", " "))}</div>
          </div>
          <div>
            <div class="label">Generated</div>
            <div class="value">${escapeHtml(new Date(record.createdAt).toLocaleString())}</div>
          </div>
          <div>
            <div class="label">Preview Id</div>
            <div class="value">${escapeHtml(record.id)}</div>
          </div>
        </div>
      </div>
      <div class="content">${record.html}</div>
    </div>
  </body>
</html>`;
}
