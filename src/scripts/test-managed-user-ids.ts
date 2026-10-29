import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { managedUserParamsSchema } from "../modules/user-management/user-management.validation";

for (const id of ["11111111-1111-1111-1111-111111111111", randomUUID(), "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"]) {
  assert.equal(managedUserParamsSchema.parse({ id }).id, id);
}
for (const id of ["", "not-a-uuid", "11111111111111111111111111111111", "11111111-1111-1111-1111-11111111111z", "11111111-1111-1111-1111-111111111111/extra", undefined, 123]) {
  assert.equal(managedUserParamsSchema.safeParse({ id }).success, false);
}
console.log("PASS managed-user IDs: legacy seeded admin and generated UUIDs accepted; malformed identifiers rejected");
