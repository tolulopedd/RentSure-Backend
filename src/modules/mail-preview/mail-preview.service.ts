import crypto from "crypto";
import { env } from "../../config/env";

type MailPreviewCategory =
  | "EMAIL_VERIFICATION"
  | "AGENT_INVITE"
  | "PROPERTY_LINK_RESPONSE"
  | "RENTER_INVITE"
  | "RENTER_DECISION"
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

function categoryLabel(category: MailPreviewCategory) {
  if (category === "EMAIL_VERIFICATION") return "Email Verification";
  if (category === "AGENT_INVITE") return "Agent Invite";
  if (category === "PROPERTY_LINK_RESPONSE") return "Property Link Response";
  if (category === "RENTER_INVITE") return "Renter Invite";
  if (category === "RENTER_DECISION") return "Renter Decision";
  if (category === "RENTER_NOTIFICATION") return "Renter Notification";
  if (category === "RENTER_SHARE_REPORT") return "Rent Score Share";
  return "Password Reset";
}

function categoryTheme(category: MailPreviewCategory) {
  if (category === "EMAIL_VERIFICATION") {
    return {
      badgeBg: "#dbeafe",
      badgeText: "#1d4ed8",
      accent: "#2563eb",
      tint: "rgba(37,99,235,0.12)"
    };
  }
  if (category === "AGENT_INVITE") {
    return {
      badgeBg: "#e0e7ff",
      badgeText: "#4338ca",
      accent: "#4f46e5",
      tint: "rgba(79,70,229,0.12)"
    };
  }
  if (category === "PROPERTY_LINK_RESPONSE") {
    return {
      badgeBg: "#ede9fe",
      badgeText: "#5b21b6",
      accent: "#7c3aed",
      tint: "rgba(124,58,237,0.12)"
    };
  }
  if (category === "RENTER_INVITE") {
    return {
      badgeBg: "#ede9fe",
      badgeText: "#6d28d9",
      accent: "#7c3aed",
      tint: "rgba(124,58,237,0.12)"
    };
  }
  if (category === "RENTER_DECISION") {
    return {
      badgeBg: "#e0f2fe",
      badgeText: "#0369a1",
      accent: "#0284c7",
      tint: "rgba(2,132,199,0.12)"
    };
  }
  if (category === "RENTER_NOTIFICATION") {
    return {
      badgeBg: "#dcfce7",
      badgeText: "#15803d",
      accent: "#16a34a",
      tint: "rgba(22,163,74,0.12)"
    };
  }
  if (category === "RENTER_SHARE_REPORT") {
    return {
      badgeBg: "#fef3c7",
      badgeText: "#b45309",
      accent: "#d97706",
      tint: "rgba(217,119,6,0.12)"
    };
  }
  return {
    badgeBg: "#fee2e2",
    badgeText: "#b91c1c",
    accent: "#dc2626",
    tint: "rgba(220,38,38,0.12)"
  };
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
  const theme = categoryTheme(record.category);
  const readableCategory = categoryLabel(record.category);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(record.subject)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      .frame { max-width: 840px; margin: 32px auto; padding: 0 20px; }
      .meta, .content { border: 1px solid #dbe4f3; border-radius: 20px; background: white; box-shadow: 0 12px 40px -28px rgba(15, 23, 42, 0.25); }
      .meta { padding: 20px 24px; margin-bottom: 20px; background: radial-gradient(circle at top left, ${theme.tint}, transparent 35%), linear-gradient(135deg, #ffffff, #f8fbff); }
      .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
      .label { font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${theme.accent}; }
      .value { margin-top: 6px; font-size: 14px; color: #334155; word-break: break-word; }
      .content { padding: 24px; }
      .badge { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 12px; background: ${theme.badgeBg}; color: ${theme.badgeText}; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .subcopy { margin-top: 10px; font-size: 14px; color: #64748b; }
      @media (max-width: 720px) { .meta-grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="meta">
        <div class="badge">${escapeHtml(readableCategory)}</div>
        <div class="label" style="margin-top: 14px;">RentSure Mail Preview</div>
        <h1 style="margin: 10px 0 0; font-size: 28px;">${escapeHtml(record.subject)}</h1>
        <p class="subcopy">Preview the final email body and metadata for this delivery category.</p>
        <div class="meta-grid">
          <div>
            <div class="label">To</div>
            <div class="value">${escapeHtml(record.to)}</div>
          </div>
          <div>
            <div class="label">Category</div>
            <div class="value">${escapeHtml(readableCategory)}</div>
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
