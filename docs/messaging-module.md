# RentSure messaging module

Additive, persistent two-person conversations for Renters, Landlords and Admins. No existing decision, payment, scoring or identity workflow is changed by this module.

## Portals and behavior

- Renter and Landlord: /account/messages. Admin: /app/messages.
- Dashboard navigation and header message shortcut with unread-message badge; mobile navigation also includes Messages.
- Inbox (received), Sent (sent at least one message), Unread and Archived folders. Inbox and Sent may contain the same thread.
- Search subject, participant name and full message text, scoped to the signed-in participant. Lists paginate in batches of 30.
- Thread history shows sender, recipient, timestamp, content, new-message marker and sent/read status. History is ordered by a server-assigned sequence and paginates in batches of 100.
- Reading advances a per-participant monotonic cursor only through fetched messages. Later arrivals stay unread. Unread totals include archived messages.
- Archive affects only the current participant. Reopen preserves history; new messages reopen a thread for both participants.
- Polling: lists and header counts every 10 seconds; open history every 8 seconds and on focus. This is not websocket delivery.
- Failed submissions preserve the draft and reuse a client request UUID when retrying the same payload.

## Access and context

| Pair | Who can initiate/reply | Access requirement |
| --- | --- | --- |
| Renter ↔ Landlord | Either participant | An existing renter case on a property with that landlord's membership |
| Renter ↔ Admin | Either participant | Active accounts |
| Landlord ↔ Admin | Either participant | Active accounts |

All requests recheck account status and role from the database. History, replies, read status and archive operations require exact conversation membership. Other Admins have no implicit access to private conversations. Agents, same-role public pairs, Admin-to-Admin and self-messaging are outside this module.

Existing participants retain their history and ability to reply if a property relationship later changes. Account suspension blocks access. Participant name/role snapshots remain available for accountability; actor identities are not cascading account foreign keys. There are no message edit/delete or participant replacement endpoints.

Optional property, application and approved-tenancy contexts are validated against both participants' access, with saved labels. Tenancy refers to the application's existing APPROVED decision, consistent with the current data model. Support conversations are available with Admins. There is no separate support-ticket entity in the existing application to link; the support conversation itself records the request and replies.

## Notification event matrix

| Event | In-app recipient | Email recipient | Destination |
| --- | --- | --- | --- |
| Renter starts/replies to Landlord | Participating Landlord | Same Landlord | Exact conversation |
| Landlord starts/replies to Renter | Participating Renter | Same Renter | Exact conversation |
| Renter starts/replies to Admin | Participating Admin | Same Admin | Exact Admin conversation |
| Admin starts/replies to Renter | Participating Renter | Same Renter | Exact conversation |
| Landlord starts/replies to Admin | Participating Admin | Same Admin | Exact Admin conversation |
| Admin starts/replies to Landlord | Participating Landlord | Same Landlord | Exact conversation |
| Read, search, archive, reopen | None | None | Personal mailbox state only |
| Retry of an already accepted message | No duplicate | No duplicate | Original message returned |

The existing notification bell/history, email templates and durable email worker are reused. Email includes sender and subject, with a direct authenticated conversation link; the message body stays inside the app. Message insertion, in-app notification and email job creation commit together. Email provider outages cannot roll back committed messages. Worker retries use stable delivery keys.

Conversation creation and message submission use account-scoped request keys and PostgreSQL transaction locks. Reusing a request key with changed content returns HTTP 409. Per-conversation locks assign a unique increasing sequence.

## Deployment

Apply Prisma migration 202610280001_messaging and regenerate the client before starting the updated API. The migration only adds Conversation, ConversationParticipant and ConversationMessage tables/indexes. The existing notification worker must run, with APP_WEB_BASE_URL configured for correct email links and production email credentials configured. Migration was applied to the local development database; production deployment is separate.

## Verification

Run:
- npm run test:messaging -w @rentsure/api
- npm run lint -w @rentsure/api
- npm run build -w @rentsure/web

The messaging test uses real HTTP routes, signed authentication tokens, temporary local PostgreSQL fixtures and a simulated email transport. It covers all six initiation/reply directions; notification recipient and link correctness; participant access denial; role/status checks; valid/invalid contexts; concurrent retry deduplication; conflicting keys; inbox/sent/unread/search; read cursor behavior; per-person archive/reopen; 103-message pagination; validation; and durable email failure/retry.

Fixtures are removed on exit. The test refuses nonlocal databases or configured live email credentials. These tests verify API behavior and queued/simulated delivery, not actual mailbox receipt or browser visual behavior.
