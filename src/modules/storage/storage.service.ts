import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import type { PublicAccountDocument, PublicDocumentType } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { env } from "../../config/env";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DOCUMENT_MIME_TYPES = new Set([...IMAGE_MIME_TYPES, "application/pdf"]);

type S3Method = "GET" | "PUT";

type StorageConfig = {
  bucketName: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  endpoint: string;
  forcePathStyle: boolean;
  presignExpiresSeconds: number;
  viewUrlExpiresSeconds: number;
  uploadMaxBytes: number;
  publicBaseUrl: string;
};

export type PublicDocumentAsset = {
  id: string;
  documentType: PublicDocumentType;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  viewUrl: string | null;
};

function getStorageConfig(): StorageConfig | null {
  if (!env.S3_BUCKET_NAME || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    return null;
  }

  return {
    bucketName: env.S3_BUCKET_NAME,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    sessionToken: env.S3_SESSION_TOKEN,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    presignExpiresSeconds: env.S3_PRESIGN_EXPIRES_SECONDS,
    viewUrlExpiresSeconds: env.S3_VIEW_URL_EXPIRES_SECONDS,
    uploadMaxBytes: env.S3_UPLOAD_MAX_BYTES,
    publicBaseUrl: env.S3_PUBLIC_BASE_URL
  };
}

function appApiBaseUrl() {
  return env.APP_API_BASE_URL || `http://localhost:${env.PORT}`;
}

function localUploadsRoot() {
  return path.resolve(process.cwd(), "uploads");
}

function requireStorageConfig(): StorageConfig {
  const config = getStorageConfig();
  if (!config) {
    throw new AppError("S3 document storage is not configured", 503, "STORAGE_NOT_CONFIGURED");
  }
  return config;
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (match) => `%${match.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeCanonicalQueryValue(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (match) => `%${match.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildRequestTarget(config: StorageConfig, objectKey: string) {
  const encodedKey = objectKey.split("/").map(encodePathSegment).join("/");
  if (config.endpoint) {
    const endpoint = new URL(config.endpoint);
    if (config.forcePathStyle) {
      return {
        origin: endpoint.origin,
        host: endpoint.host,
        canonicalUri: `/${config.bucketName}/${encodedKey}`,
        unsignedUrl: `${endpoint.origin}/${config.bucketName}/${encodedKey}`
      };
    }

    const host = `${config.bucketName}.${endpoint.host}`;
    return {
      origin: `${endpoint.protocol}//${host}`,
      host,
      canonicalUri: `/${encodedKey}`,
      unsignedUrl: `${endpoint.protocol}//${host}/${encodedKey}`
    };
  }

  if (config.forcePathStyle) {
    const host = `s3.${config.region}.amazonaws.com`;
    return {
      origin: `https://${host}`,
      host,
      canonicalUri: `/${config.bucketName}/${encodedKey}`,
      unsignedUrl: `https://${host}/${config.bucketName}/${encodedKey}`
    };
  }

  const host = `${config.bucketName}.s3.${config.region}.amazonaws.com`;
  return {
    origin: `https://${host}`,
    host,
    canonicalUri: `/${encodedKey}`,
    unsignedUrl: `https://${host}/${encodedKey}`
  };
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function hmac(key: Buffer | string, value: string) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function getSigningKey(secretAccessKey: string, shortDate: string, region: string) {
  const kDate = hmac(`AWS4${secretAccessKey}`, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function buildPresignedUrl(input: {
  method: S3Method;
  objectKey: string;
  contentType?: string;
  expiresSeconds: number;
}) {
  const config = requireStorageConfig();
  const now = new Date();
  const amzDate = toAmzDate(now);
  const shortDate = amzDate.slice(0, 8);
  const credentialScope = `${shortDate}/${config.region}/s3/aws4_request`;
  const target = buildRequestTarget(config, input.objectKey);

  const signedHeaders = input.contentType ? "content-type;host" : "host";
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders
  });

  if (config.sessionToken) {
    query.set("X-Amz-Security-Token", config.sessionToken);
  }

  const sortedQuery = Array.from(query.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    )
    .map(([key, value]) => `${encodeCanonicalQueryValue(key)}=${encodeCanonicalQueryValue(value)}`)
    .join("&");

  const canonicalHeaders = input.contentType
    ? `content-type:${input.contentType}\nhost:${target.host}\n`
    : `host:${target.host}\n`;

  const canonicalRequest = [
    input.method,
    target.canonicalUri,
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");

  const signature = crypto.createHmac("sha256", getSigningKey(config.secretAccessKey, shortDate, config.region)).update(stringToSign, "utf8").digest("hex");
  return `${target.unsignedUrl}?${sortedQuery}&X-Amz-Signature=${signature}`;
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim().replace(/\s+/g, "-");
  const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, "");
  return safe || "document";
}

function randomSuffix() {
  return crypto.randomBytes(8).toString("hex");
}

function buildObjectKey(publicAccountId: string, documentType: PublicDocumentType, fileName: string) {
  const safeName = sanitizeFileName(fileName);
  return `public-accounts/${publicAccountId}/${documentType.toLowerCase()}/${Date.now()}-${randomSuffix()}-${safeName}`;
}

function toLocalObjectKey(publicAccountId: string, documentType: PublicDocumentType, fileName: string) {
  return `local/${buildObjectKey(publicAccountId, documentType, fileName)}`;
}

function allowedMimeTypes(documentType: PublicDocumentType) {
  return documentType === "PASSPORT_PHOTO" ? IMAGE_MIME_TYPES : DOCUMENT_MIME_TYPES;
}

function maxFileSizeBytes(documentType: PublicDocumentType) {
  const configured = Math.max(env.S3_UPLOAD_MAX_BYTES, 1);
  if (documentType === "PASSPORT_PHOTO") {
    return Math.min(configured, 3 * 1024 * 1024);
  }
  return configured;
}

function assertValidDocumentUpload(input: {
  documentType: PublicDocumentType;
  contentType: string;
  fileSize: number;
  fileName: string;
}) {
  if (!allowedMimeTypes(input.documentType).has(input.contentType)) {
    throw new AppError("This file type is not allowed for the selected document", 400, "INVALID_FILE_TYPE");
  }

  if (!input.fileName.trim()) {
    throw new AppError("File name is required", 400, "VALIDATION_ERROR");
  }

  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    throw new AppError("File size must be greater than zero", 400, "VALIDATION_ERROR");
  }

  if (input.fileSize > maxFileSizeBytes(input.documentType)) {
    throw new AppError(`File is too large. Maximum allowed size is ${Math.floor(maxFileSizeBytes(input.documentType) / (1024 * 1024))}MB.`, 400, "FILE_TOO_LARGE");
  }
}

function assertObjectKeyOwnership(publicAccountId: string, objectKey: string) {
  const expectedPrefix = `public-accounts/${publicAccountId}/`;
  const localExpectedPrefix = `local/${expectedPrefix}`;
  if (!objectKey.startsWith(expectedPrefix) && !objectKey.startsWith(localExpectedPrefix)) {
    throw new AppError("This uploaded document does not belong to the current account", 400, "INVALID_DOCUMENT_KEY");
  }
}

export function storageConfigured() {
  return Boolean(getStorageConfig());
}

export async function createPublicDocumentUploadIntent(input: {
  publicAccountId: string;
  documentType: PublicDocumentType;
  fileName: string;
  contentType: string;
  fileSize: number;
}) {
  assertValidDocumentUpload(input);
  const objectKey = buildObjectKey(input.publicAccountId, input.documentType, input.fileName);
  const uploadUrl = buildPresignedUrl({
    method: "PUT",
    objectKey,
    contentType: input.contentType,
    expiresSeconds: requireStorageConfig().presignExpiresSeconds
  });

  return {
    objectKey,
    uploadUrl,
    method: "PUT" as const,
    requiredHeaders: {
      "Content-Type": input.contentType
    }
  };
}

export async function attachPassportPhotoToPublicAccount(input: {
  publicAccountId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}) {
  assertValidDocumentUpload({
    documentType: "PASSPORT_PHOTO",
    contentType: input.mimeType,
    fileSize: input.fileSize,
    fileName: input.fileName
  });
  assertObjectKeyOwnership(input.publicAccountId, input.objectKey);

  const document = await prisma.publicAccountDocument.create({
    data: {
      publicAccountId: input.publicAccountId,
      documentType: "PASSPORT_PHOTO",
      fileName: sanitizeFileName(input.fileName),
      objectKey: input.objectKey,
      mimeType: input.mimeType,
      fileSize: input.fileSize
    }
  });

  await prisma.publicAccount.update({
    where: { id: input.publicAccountId },
    data: {
      passportPhotoDocumentId: document.id
    }
  });

  return document;
}

export function buildPublicDocumentViewUrl(objectKey: string) {
  if (objectKey.startsWith("local/")) {
    const relativePath = objectKey.slice("local/".length);
    return `${appApiBaseUrl().replace(/\/+$/, "")}/uploads/${relativePath.split("/").map(encodePathSegment).join("/")}`;
  }

  const config = requireStorageConfig();
  if (config.publicBaseUrl) {
    const base = config.publicBaseUrl.replace(/\/+$/, "");
    return `${base}/${objectKey.split("/").map(encodePathSegment).join("/")}`;
  }

  return buildPresignedUrl({
    method: "GET",
    objectKey,
    expiresSeconds: config.viewUrlExpiresSeconds
  });
}

export function toPublicDocumentAsset(document: Pick<PublicAccountDocument, "id" | "documentType" | "fileName" | "mimeType" | "fileSize" | "createdAt" | "objectKey"> | null | undefined): PublicDocumentAsset | null {
  if (!document) return null;

  let viewUrl: string | null = null;
  try {
    viewUrl = buildPublicDocumentViewUrl(document.objectKey);
  } catch {
    viewUrl = null;
  }

  return {
    id: document.id,
    documentType: document.documentType,
    fileName: document.fileName,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    createdAt: document.createdAt.toISOString(),
    viewUrl
  };
}

export async function saveLocalPublicDocumentUpload(input: {
  publicAccountId: string;
  documentType: PublicDocumentType;
  fileName: string;
  contentType: string;
  fileSize: number;
  base64Data: string;
}) {
  assertValidDocumentUpload({
    documentType: input.documentType,
    contentType: input.contentType,
    fileSize: input.fileSize,
    fileName: input.fileName
  });

  const cleanBase64 = input.base64Data.replace(/^data:[^;]+;base64,/, "").trim();
  const buffer = Buffer.from(cleanBase64, "base64");
  if (!buffer.length) {
    throw new AppError("Uploaded file is empty", 400, "VALIDATION_ERROR");
  }

  if (buffer.length !== input.fileSize) {
    throw new AppError("Uploaded file size does not match the provided size", 400, "VALIDATION_ERROR");
  }

  const objectKey = toLocalObjectKey(input.publicAccountId, input.documentType, input.fileName);
  const relativePath = objectKey.slice("local/".length);
  const targetPath = path.join(localUploadsRoot(), relativePath);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer);

  return {
    objectKey,
    fileName: sanitizeFileName(input.fileName),
    mimeType: input.contentType,
    fileSize: buffer.length
  };
}
