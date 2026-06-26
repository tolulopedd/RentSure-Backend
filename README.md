# RentSure API

Express + Prisma backend with:

- JWT access + refresh token rotation
- RentSure roles (`ADMIN`, `AGENT`, `LANDLORD`, `RENTER`)
- Request ID propagation (`x-request-id`)
- Audit logs persisted in Postgres
- Configurable rent-score engine for renters

## Key endpoints

- `GET /api/health`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/verify-email`
- `POST /api/auth/refresh`
- `GET /api/rent-score/me`
- `GET /api/admin/rent-score/config`
- `PATCH /api/admin/rent-score/config`
- `POST /api/admin/rent-score/rules`
- `PATCH /api/admin/rent-score/rules/:ruleId`
- `GET /api/admin/rent-score/accounts`
- `GET /api/admin/rent-score/accounts/:publicAccountId`
- `POST /api/admin/rent-score/accounts/:publicAccountId/events`
- `DELETE /api/admin/rent-score/events/:eventId`
