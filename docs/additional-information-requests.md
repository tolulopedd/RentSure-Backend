# Landlord requests for additional information

The Landlord Decision page now provides a multi-select list of values:
- Work History
- Work Reference Letter

At least one selection is required for a new additional-information request. A decision note remains optional. Approval and rejection retain their existing behavior; landlords can now continue from a HOLD decision to a final decision.

The renter receives the exact selections and landlord note in the in-app notification and queued email. Both link to the selected application on Landlord Decision. Work History is provided as text; Work Reference Letter uses the existing upload service (PDF, JPG or PNG, maximum 5 MB). Both must be supplied when both are requested.

Submitting stores the response, records an audit activity, and notifies the requesting landlord through the existing in-app and email services. The landlord can review the text and open the uploaded letter on the decision page. Email notifications contain the item names and a review link, not the submitted work history or document.

Responses are restricted to the linked renter and current request version. Account status, document ownership prefix, MIME type and size are validated. Requests and responses share a transaction lock. Repeated identical requests preserve their timestamp and response; repeated responses create no duplicate notification. Changing a request starts a new response, with previous submissions retained in activity metadata. Approval/rejection preserves the latest submitted response.

Existing HOLD records remain visible; the landlord can select items to turn them into structured requests.

## Notification events

| Event | Recipient | Channels | Destination |
| --- | --- | --- | --- |
| Additional information requested | Renter; existing linked stakeholders retain their activity notifications | In-app and email | Renter's selected decision/application |
| Requested information submitted | Requesting landlord | In-app and email | Landlord's selected application decision |
| Duplicate request or submission | No duplicate notification | — | — |

## Deployment and verification

Apply migration 202610280002_additional_information and regenerate Prisma before deploying the API and web application. This adds two fields to ProposedRenter. The migration was applied locally.

Regression coverage is in apps/api/src/scripts/test-notifications.ts, including real local document uploads, selection persistence, renter/landlord views, both notification channels, duplicate handling, access restrictions, stale requests, retained responses after approval, and HTTP endpoint validation. Email transport is simulated; actual mailbox receipt is not asserted.
