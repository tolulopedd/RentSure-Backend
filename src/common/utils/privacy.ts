import type { Prisma } from "@prisma/client";

const SENSITIVE_KEYS = new Set([
  "password",
  "pin",
  "otp",
  "idnumber",
  "nationalid",
  "accountnumber",
  "customeraccount",
  "phone",
  "customerphone",
  "ssn",
  "bvn"
]);

function maskMid(value: string, left = 2, right = 2) {
  if (value.length <= left + right) {
    return `${value.slice(0, 1)}***`;
  }

  const middleLength = Math.max(3, value.length - left - right);
  return `${value.slice(0, left)}${"*".repeat(middleLength)}${value.slice(-right)}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = phone.replace(/\s+/g, "");
  return maskMid(normalized, 3, 2);
}

export function maskAccount(account: string | null | undefined): string | null {
  if (!account) return null;
  const normalized = account.replace(/\s+/g, "");
  return maskMid(normalized, 2, 2);
}

export function maskName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  return trimmed
    .split(/\s+/)
    .map((part) => (part.length <= 2 ? `${part.charAt(0)}*` : `${part.charAt(0)}${"*".repeat(part.length - 1)}`))
    .join(" ");
}

function normalizeKey(key: string) {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function redactValueByKey(key: string, value: unknown): unknown {
  if (typeof value !== "string") return "[REDACTED]";

  if (key.includes("phone")) {
    return maskPhone(value) ?? "[REDACTED]";
  }

  if (key.includes("account") || key.includes("id")) {
    return maskAccount(value) ?? "[REDACTED]";
  }

  return "[REDACTED]";
}

function redactInternal(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactInternal(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      const normalized = normalizeKey(key);
      const isSensitive = SENSITIVE_KEYS.has(normalized);

      output[key] = isSensitive ? redactValueByKey(normalized, nested) : redactInternal(nested);
    }
    return output;
  }

  return value;
}

export function redactForStorage(payload: unknown): Prisma.InputJsonValue {
  const redacted = redactInternal(payload);
  if (redacted === undefined) {
    return { value: null } as Prisma.InputJsonValue;
  }
  return redacted as Prisma.InputJsonValue;
}
