# RentSure stakeholder notification audit

Updated 28 October 2026. This enhancement preserves existing business decisions, permissions, score calculations, payment providers, and portal layouts. It extends the existing notification table and transactional email templates.

## Delivery contract

Registered recipients receive an in-app entry and a durable email job. Each notification identifies the action and links to the appropriate portal page. Record selectors on the landlord/agent queue, payments, decisions, and renter linked-properties pages support notification `caseId` links. Private internal comments are not copied into emails or sent to renters.

Unregistered invitees cannot have an in-app inbox: they receive email first. Pending property/agent invitations and shared-score summaries are attached to the correct account at signup. Verification/reset links remain the existing authentication emails; successful signup/password changes also notify the account.

| Action / event | Recipient(s) | Destination / next action | Channels |
|---|---|---|---|
| Agent invited to property | Invited agent | Properties; accept or decline | Both if registered; email otherwise |
| Agent accepts / declines invitation | Inviting landlord | Properties; review assignment | Both |
| Another agent accepts and closes outstanding invitations | Other invited agents | Properties; invitation no longer available | Both if registered; email otherwise |
| Renter linked / application created | Linked renter, other property members excluding actor | Linked Properties / Link Tenant; review and respond | Both; invitation email for unregistered renter |
| Invitation reminder or corrected invitation email | Correct intended renter; internal property stakeholders get activity notice | Signup / linked property | Both if registered; email otherwise |
| Renter accepts or withdraws property link | Linked landlords and agents excluding actor | Link Tenant; review response | Both |
| Landlord approves / declines / holds application | Renter and other property members | Linked Properties / Link Tenant; view decision, provide requested information for hold | Both; email for unregistered renter |
| Payment schedule created, including recurring schedules | Renter and other property members | Payments; review amount/date and recurrence | Both; one notification for the schedule operation |
| Payment status changed | Renter and other property members | Payments; review status | Both |
| Renter submits scheduled or self-initiated payment proof | Linked landlords and agents | Payments; landlord reviews proof | Both |
| Renter directly confirms payment | Linked landlords and agents | Payments; review recorded payment | Both |
| Landlord confirms full payment / marks payment partial | Renter and other property members | Payments; review outcome and balance | Both |
| Rent Score request created | Linked renter | Linked Properties; accept/share request | Both |
| Renter accepts Rent Score request | Intended requester / forwarded recipient | Link Tenant; review consent | Both |
| Agent forwards report | Selected linked landlord only | Link Tenant; review report | Both |
| Renter explicitly shares score | Selected landlord or agent only | Notification history contains score summary; email contains shared score | Both if registered; email/signup otherwise |
| Profile changes affecting Rent Score | Renter | Renter dashboard; view before/after score and breakdown | Both; unchanged scores stay quiet |
| NIN / BVN saved or changed | Renter | Profile; score recalculated automatically | Both; no identity number in notifications |
| Legacy pending identity review approved / failed | Renter | Profile; review or correct details | Both, queued in same review transaction |
| Landlord reference requested | Selected landlord only | Link Tenant; provide or decline reference | Both |
| Landlord reference completed / declined | Renter and other property members | Linked Properties / Link Tenant; review outcome | Both |
| Behaviour / property-maintenance / lease-compliance review | Renter and other property members | Linked Properties / Link Tenant; review ratings | Both |
| Internal application comment | Other property members only | Link Tenant; read authorized internal note | Both; email contains a generic activity summary |
| Property/unit details updated | Other property members and accepted linked renters | Properties / Linked Properties | Both; no other tenants' personal details |
| Admin adds/deletes a score event or adds/removes a score override | Affected renter | Renter dashboard; view score breakdown | Both |
| Admin changes score rules/categories/policy | Active renters | Renter dashboard; view score under current rules | Both; batched database inserts |
| Rent Score checkout initiated | Buyer | Buy Score / Decisions; complete payment | Both |
| Manual Rent Score transfer pending confirmation | Buyer and active Admin/Super Admin (including legacy null-role admins) | Buyer payment page; Admin notification identifies payment reference | Both |
| Rent Score payment succeeded / failed | Buyer | Payment page; review result or retry | Both |
| Successful Rent Score payment awaits report approval | Active Admin/Super Admin | Admin notification includes payment reference | Both; service-level approval workflow caveat below |
| Admin approves paid report | Buyer | Buy Score / Decisions | Both; repeat approval sends no duplicate |
| Admin updates account profile / status | Affected Renter, Landlord, Agent, or Admin | Own profile | Both; internal admin notes omitted |
| Administrator account created | New Admin | Sign in using separately supplied credentials | Both |
| Admin role changed | Affected Admin | Admin profile | Both |
| Signup completed | New account | Own profile; finish onboarding | Both |
| Password reset completed / staff changes password | Affected account | Sign-in page; recover account if unexpected | Both |
| Existing invitation or score share attaches at signup | Newly registered intended recipient | Properties / Linked Properties / notification summary | Both |

## Audit boundaries and existing gaps

- Audited all API module route/service files, Prisma models, portal routes, topbars, notification history, and existing email calls.
- There is no support-ticket/request service, route, or persisted ticket model. No support workflow was invented. Add a transaction-scoped `notifyUser`/`notifyAdmins` call when that feature is introduced.
- Tenancy is represented by approved linked renters, unit occupancy, payment schedules, and landlord reviews. There is no separate lease-signing, renewal, termination, or maintenance-ticket workflow to attach notifications to.
- `confirmManualRentScorePayment` and `approveRentScoreReport` already exist as service functions but are not wired to an API route or an Admin approval screen. Their notifications are implemented and service-tested. Admin receives the actionable reference in its inbox; adding a payment approval UI/API is a separate business feature. The notification does not imply that approval can currently be completed from the dashboard.
- Renter score shares were persisted and previewed but not delivered. Email now delivers the shared score and the intended recipient's inbox shows the summary. The application has no separate recipient-facing shared-report viewer; this enhancement does not invent one or grant new score access to agents.
- Login/logout, ordinary reads/searches, exports, notification read toggles, upload intents, and internal admin notes do not broadcast stakeholder notifications. Token verification/reset emails keep their existing immediate-delivery behavior.
- Payment due/overdue timers, scheduled reminders, new support workflows, and new approval APIs are not existing event producers and were not introduced.
- No historical notification/email backfill is run.

## Reliability and access

- `PublicAccountNotification` supports exactly one public-account or staff recipient, enforced by a database check constraint. Existing public entries remain intact.
- `NotificationEmail` is a durable outbox. Domain transactions insert messages but do not contact the email provider. Rollback removes both in-app entries and queued email.
- The API process polls committed jobs every ten seconds. Workers claim jobs atomically using a lease/token. Failed attempts back off up to one hour; a process restart resumes pending jobs. Delivery failure never rolls back a completed business action.
- Stable event keys are unique per recipient. Transaction-scoped advisory locks avoid concurrent Prisma upsert races. Replayed payment states and identical repeated status activities are suppressed. Separate comments and separate schedule creation operations remain separate events.
- The provider receives a stable idempotency key per outbox job. As with any email provider, retries outside the provider's idempotency retention window cannot guarantee exactly-once delivery after an ambiguous network result. The outbox prevents ordinary duplicate dispatch and retains delivery errors for diagnosis.
- The same bell component is used in all portals. It retains the existing visual treatment, adds Admin access and mark-unread, awaits mutations, surfaces failures, and refreshes after a change or window focus. History loads older pages. Unread totals count all unread rows, not just the latest 50.
- Every list/read/unread/read-all operation scopes to the authenticated account ID and account scope. A public account cannot operate on a staff notification, or another public account's entry.
- Generated notification text is HTML-escaped. Notification CTAs are confined to local app paths. Identity numbers, payment proof URLs, private admin notes, and full internal comments are not included in generic emails.

## Deployment and operation

1. Apply `apps/api/prisma/migrations/202610270001_notification_delivery/migration.sql` through `prisma migrate deploy` before deploying the new API. This additive migration was applied to the local development database for verification.
2. Run Prisma client generation and the usual API/web builds. Restart the API to start the queue worker; it is registered in `src/server.ts`.
3. Configure the existing `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, optional `RESEND_REPLY_TO`, and `APP_WEB_BASE_URL` for live delivery. In development without credentials, delivery is captured as a preview. In production without credentials, jobs remain pending and retry with an error recorded.
4. Monitor `NotificationEmail` rows with `deliveredAt IS NULL`, `attempts`, `availableAt`, and `lastError`, and the `notification.email_failed` log. Do not manually mark failed jobs delivered. Once configuration/service availability is restored, retries resume automatically.

## Validation

`npm run test:notifications -w @rentsure/api` exercises temporary local fixtures and refuses live email credentials or a remote database. It covers the workflows listed in the test output, recipient isolation, both-channel queue creation, repeated approvals, concurrent event creation, transaction rollback, provider failure/retry, concurrent workers, HTML escaping, safe URLs, scope/ownership authorization, pagination, unread totals, and read/unread state. Delivery is simulated; this does not claim external inbox delivery.

`npm run lint -w @rentsure/api` checks API types. `npm run build -w @rentsure/web` checks web types and production bundling. The notification suite verifies business-service operations; a full browser/manual pass and live provider/inbox verification remain deployment checks.

Final local verification: **19 notification regression groups passed**, API TypeScript check passed, and web production build passed. The build reports its existing large-bundle advisory. External inbox delivery and a full browser walkthrough were not performed.
