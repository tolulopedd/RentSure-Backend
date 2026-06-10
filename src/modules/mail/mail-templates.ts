function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderButton(label: string, href: string) {
  return `
    <a href="${href}" style="display:inline-block;border-radius:14px;background:#1d4ed8;color:#ffffff;padding:13px 18px;text-decoration:none;font-weight:600;">
      ${escapeHtml(label)}
    </a>
  `;
}

function renderParagraph(text: string) {
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:#334155;">${text}</p>`;
}

export function renderTransactionalEmail(input: {
  eyebrow?: string;
  title: string;
  greeting?: string;
  paragraphs: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  helperText?: string;
  helperUrl?: string;
  sectionHtml?: string;
  closing?: string;
}) {
  const greeting = input.greeting ? `<p style="margin:0 0 18px;font-size:14px;color:#475569;">${input.greeting}</p>` : "";
  const paragraphs = input.paragraphs.map((paragraph) => renderParagraph(paragraph)).join("");
  const cta =
    input.ctaLabel && input.ctaUrl
      ? `<div style="margin:28px 0 22px;">${renderButton(input.ctaLabel, input.ctaUrl)}</div>`
      : "";
  const helper =
    input.helperText && input.helperUrl
      ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.7;color:#64748b;">${escapeHtml(input.helperText)}<br /><a href="${input.helperUrl}" style="color:#1d4ed8;word-break:break-all;">${input.helperUrl}</a></p>`
      : "";
  const closing = input.closing
    ? `<p style="margin:24px 0 0;font-size:14px;line-height:1.8;color:#334155;">${input.closing}</p>`
    : `<p style="margin:24px 0 0;font-size:14px;line-height:1.8;color:#334155;">Best regards,<br />The RentSure Team</p>`;

  return `
    <div style="margin:0;padding:32px 16px;background:#f8fbff;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;">
        <div style="border:1px solid #dbe4f3;border-radius:28px;background:#ffffff;box-shadow:0 18px 54px -36px rgba(15,23,42,0.35);overflow:hidden;">
          <div style="padding:26px 28px;background:radial-gradient(circle at top left, rgba(29,78,216,0.12), transparent 34%), linear-gradient(135deg,#ffffff,#f4f8ff 62%,#edf4ff);border-bottom:1px solid #e2e8f0;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#1d4ed8;">${escapeHtml(
              input.eyebrow || "RentSure"
            )}</div>
            <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;color:#0f172a;">${escapeHtml(input.title)}</h1>
          </div>
          <div style="padding:28px;">
            ${greeting}
            ${paragraphs}
            ${input.sectionHtml || ""}
            ${cta}
            ${helper}
            ${closing}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderInfoPanel(input: { label: string; value: string; note?: string }) {
  return `
    <div style="border:1px solid #dbe4f3;border-radius:18px;padding:16px;background:#f8fbff;margin:20px 0;">
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#1d4ed8;">${escapeHtml(input.label)}</p>
      <p style="margin:8px 0 0;font-size:28px;font-weight:700;color:#0f172a;">${escapeHtml(input.value)}</p>
      ${input.note ? `<p style="margin:8px 0 0;font-size:14px;color:#475569;">${escapeHtml(input.note)}</p>` : ""}
    </div>
  `;
}

