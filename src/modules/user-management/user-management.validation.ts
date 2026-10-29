import { z } from "zod";

// Legacy seeded accounts have GUIDs without RFC UUID variant bits. Keep the
// canonical hexadecimal format check while accepting IDs already stored in Postgres.
export const managedUserParamsSchema = z.object({ id: z.guid() });

