# RentSure Backend

RentSure backend API for:

- public signup, email verification, login, refresh, and reset-password flows
- renter workspace
- landlord and agent workspace
- admin rent-score configuration and review
- mail preview flow for local development
- local or S3-backed public document storage

## Stack

- Node.js
- Express
- Prisma
- PostgreSQL
- TypeScript

## Requirements

- Node.js 20+
- npm 10+
- PostgreSQL 15+

## Local setup

1. Install dependencies

```bash
npm install
```

2. Create your env file

```bash
cp .env.example .env
```

3. Generate Prisma client

```bash
npm run prisma:gen
```

4. Apply migrations

```bash
npm run prisma:migrate
```

5. Start the API

```bash
npm run dev
```

The API runs on `http://localhost:4100`.

## Available scripts

```bash
npm run dev
npm run start
npm run build
npm run lint
npm run prisma:gen
npm run prisma:migrate
```

## Environment variables

### Required

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`

### Core app configuration

- `PORT`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`
- `APP_WEB_BASE_URL`
- `APP_API_BASE_URL`
- `EMAIL_VERIFICATION_EXPIRES_HOURS`

### Optional development / integration settings

- `CBS_MODE`
- `CBS_BASE_URL`
- `CBS_API_KEY`
- `SEED_DEMO_DATA`

### Optional document storage settings

Leave these empty to use local file storage. Set them when moving document uploads to S3 or an S3-compatible service.

- `S3_BUCKET_NAME`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_SESSION_TOKEN`
- `S3_ENDPOINT`
- `S3_PUBLIC_BASE_URL`
- `S3_PRESIGN_EXPIRES_SECONDS`
- `S3_VIEW_URL_EXPIRES_SECONDS`
- `S3_FORCE_PATH_STYLE`
- `S3_UPLOAD_MAX_BYTES`

## Main API areas

- `GET /api/health`
- `POST /api/auth/signup`
- `GET /api/auth/verify-email`
- `POST /api/auth/complete-signup`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/request-password-reset`
- `GET /api/renter/dashboard`
- `GET /api/workspace/overview`
- `GET /api/admin/rent-score/config`

## Deployment notes

- Run Prisma migrations as part of deployment before starting the API.
- Set `APP_WEB_BASE_URL` to the deployed web app URL so email verification and invite links point to the correct frontend.
- Keep `uploads/` out of source control if you are using local document storage.
- For production document storage, switch to S3-compatible env settings instead of local disk.
