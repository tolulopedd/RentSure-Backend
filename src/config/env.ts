import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export const env = {
  PORT: Number(process.env.PORT ?? 4100),
  DATABASE_URL: requireEnv("DATABASE_URL"),
  JWT_ACCESS_SECRET: requireEnv("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: requireEnv("JWT_REFRESH_SECRET"),
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN ?? "30d",
  APP_WEB_BASE_URL: process.env.APP_WEB_BASE_URL ?? "http://localhost:5173",
  APP_API_BASE_URL: process.env.APP_API_BASE_URL ?? "",
  EMAIL_VERIFICATION_EXPIRES_HOURS: Number(process.env.EMAIL_VERIFICATION_EXPIRES_HOURS ?? 24),
  CBS_MODE: (process.env.CBS_MODE ?? "mock").toLowerCase(),
  CBS_BASE_URL: process.env.CBS_BASE_URL ?? "",
  CBS_API_KEY: process.env.CBS_API_KEY ?? "",
  SEED_DEMO_DATA: (process.env.SEED_DEMO_DATA ?? "false").toLowerCase() === "true",
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME ?? "",
  S3_REGION: process.env.S3_REGION ?? "us-east-1",
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "",
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "",
  S3_SESSION_TOKEN: process.env.S3_SESSION_TOKEN ?? "",
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "",
  S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL ?? "",
  S3_PRESIGN_EXPIRES_SECONDS: Number(process.env.S3_PRESIGN_EXPIRES_SECONDS ?? 900),
  S3_VIEW_URL_EXPIRES_SECONDS: Number(process.env.S3_VIEW_URL_EXPIRES_SECONDS ?? 3600),
  S3_FORCE_PATH_STYLE: (process.env.S3_FORCE_PATH_STYLE ?? "false").toLowerCase() === "true",
  S3_UPLOAD_MAX_BYTES: Number(process.env.S3_UPLOAD_MAX_BYTES ?? 5242880)
};
