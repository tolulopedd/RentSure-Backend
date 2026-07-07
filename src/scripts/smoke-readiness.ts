import "dotenv/config";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma/client";
import { env } from "../config/env";

type PublicRole = "RENTER" | "LANDLORD" | "AGENT";

type SessionAccount = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationName: string | null;
  accountType: PublicRole;
  entityType: "INDIVIDUAL" | "COMPANY";
  status: "ACTIVE" | "UNVERIFIED" | "DISABLED";
};

type ApiResult<T = unknown> = {
  status: number;
  body: T;
};

function displayName(account: Pick<SessionAccount, "firstName" | "lastName" | "organizationName">) {
  return account.organizationName?.trim() || [account.firstName, account.lastName].filter(Boolean).join(" ");
}

function createAccessToken(account: SessionAccount) {
  return jwt.sign(
    {
      userId: account.id,
      role: account.accountType,
      accountScope: "PUBLIC"
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );
}

async function api<T = unknown>(path: string, options: {
  method?: string;
  token?: string;
  body?: unknown;
} = {}): Promise<ApiResult<T>> {
  const response = await fetch(`http://localhost:4100${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return {
    status: response.status,
    body: body as T
  };
}

function assertStatus(result: ApiResult, expected: number | number[], label: string) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(result.status)) {
    throw new Error(`${label} failed. Expected ${allowed.join(" or ")}, got ${result.status}. Payload: ${JSON.stringify(result.body)}`);
  }
}

async function getSessionAccount(role: PublicRole) {
  const account = await prisma.publicAccount.findFirst({
    where: {
      accountType: role,
      status: "ACTIVE"
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      organizationName: true,
      accountType: true,
      entityType: true,
      status: true
    }
  });

  if (!account) {
    throw new Error(`No active ${role.toLowerCase()} account is available for smoke testing.`);
  }

  return account as SessionAccount;
}

async function main() {
  const landlord = await getSessionAccount("LANDLORD");
  const renter = await getSessionAccount("RENTER");

  const landlordToken = createAccessToken(landlord);
  const renterToken = createAccessToken(renter);
  const timestamp = Date.now();
  const propertyName = `Smoke Property ${timestamp}`;
  const unitLabel = `Flat 1 Ground Floor ${timestamp}`;

  console.log("Starting readiness smoke test...");
  console.log(`Landlord: ${landlord.email}`);
  console.log(`Renter: ${renter.email}`);

  assertStatus(await api("/api/renter/dashboard"), 401, "Unauthenticated renter dashboard");
  assertStatus(await api("/api/workspace/overview", { token: renterToken }), 403, "Renter blocked from landlord workspace");
  assertStatus(await api("/api/renter/dashboard", { token: landlordToken }), 403, "Landlord blocked from renter workspace");

  const landlordProfile = await api("/api/workspace/profile", { token: landlordToken });
  assertStatus(landlordProfile, 200, "Landlord profile");

  const landlordOverview = await api("/api/workspace/overview", { token: landlordToken });
  assertStatus(landlordOverview, 200, "Landlord overview");

  const renterDashboard = await api<{ profile: { firstName: string; lastName: string; phone: string; address: string; state: string; city: string } }>(
    "/api/renter/dashboard",
    { token: renterToken }
  );
  assertStatus(renterDashboard, 200, "Renter dashboard");

  const propertyCreate = await api("/api/workspace/properties", {
    method: "POST",
    token: landlordToken,
    body: {
      name: propertyName,
      ownerName: displayName(landlord),
      landlordEmail: landlord.email,
      propertyType: "Flats",
      bedroomCount: 2,
      bathroomCount: 2,
      address: "No 64 Adeniyi Jones, Ladipo Oluwole Busstop",
      city: "Ikeja",
      state: "Lagos",
      units: [
        {
          label: unitLabel,
          bedroomCount: 2,
          bathroomCount: 2,
          annualRentAmountNgn: 1200000,
          isOccupied: false
        }
      ]
    }
  });
  assertStatus(propertyCreate, 201, "Create property");

  const properties = await api<{ items: Array<{ id: string; name: string; units: Array<{ id: string; label: string }> }> }>("/api/workspace/properties", {
    token: landlordToken
  });
  assertStatus(properties, 200, "List properties");

  const property = properties.body.items.find((item) => item.name === propertyName);
  if (!property) {
    throw new Error("Created property was not returned by workspace properties.");
  }
  const propertyUnit = property.units.find((item) => item.label === unitLabel) ?? property.units[0];
  if (!propertyUnit) {
    throw new Error("Created property unit was not returned by workspace properties.");
  }

  const queueCreate = await api("/api/workspace/queue", {
    method: "POST",
    token: landlordToken,
    body: {
      propertyId: property.id,
      propertyUnitId: propertyUnit.id,
      renterAccountId: renter.id,
      firstName: renterDashboard.body.profile.firstName,
      lastName: renterDashboard.body.profile.lastName,
      email: renter.email,
      phone: renterDashboard.body.profile.phone,
      address: renterDashboard.body.profile.address,
      city: renterDashboard.body.profile.city,
      state: renterDashboard.body.profile.state
    }
  });
  assertStatus(queueCreate, 201, "Link renter to property");

  const queue = await api<{ items: Array<{ id: string; property: { id: string }; propertyUnit: { id: string } | null; email: string }> }>("/api/workspace/queue", {
    token: landlordToken
  });
  assertStatus(queue, 200, "List queue");

  const linkedCase = queue.body.items.find((item) => item.property.id === property.id && item.email.toLowerCase() === renter.email.toLowerCase());
  if (!linkedCase) {
    throw new Error("Linked renter case was not returned by workspace queue.");
  }

  const scoreRequest = await api(`/api/workspace/queue/${linkedCase.id}/score-requests`, {
    method: "POST",
    token: landlordToken,
    body: {
      notes: "Smoke readiness score request"
    }
  });
  assertStatus(scoreRequest, 201, "Request rent score");

  const renterAfterRequest = await api<{ linkedCases: Array<{ id: string; property: { id: string }; scoreRequests: Array<{ id: string; acceptedAt: string | null; shareTarget: { email: string; type: "LANDLORD" | "AGENT" } }> }> }>(
    "/api/renter/dashboard",
    { token: renterToken }
  );
  assertStatus(renterAfterRequest, 200, "Renter dashboard after score request");

  const renterLinkedCase = renterAfterRequest.body.linkedCases.find((item) => item.property.id === property.id);
  if (!renterLinkedCase) {
    throw new Error("Renter linked case was not returned after score request.");
  }

  const acceptScoreRequest = await api(`/api/renter/linked-cases/${renterLinkedCase.id}/accept-score-request`, {
    method: "POST",
    token: renterToken
  });
  assertStatus(acceptScoreRequest, 200, "Accept landlord score request");

  const shareScore = await api("/api/renter/share-report", {
    method: "POST",
    token: renterToken,
    body: {
      linkedCaseId: renterLinkedCase.id,
      recipientEmail: landlord.email,
      recipientType: "LANDLORD"
    }
  });
  assertStatus(shareScore, 200, "Share rent score");

  const queueItemAfterShare = await api<{ linkedRentScore: unknown; linkedRentScoreReport: unknown }>(
    `/api/workspace/queue/${linkedCase.id}`,
    { token: landlordToken }
  );
  assertStatus(queueItemAfterShare, 200, "Queue item after shared score");
  if (!queueItemAfterShare.body.linkedRentScore) {
    throw new Error("Linked rent score was not visible to landlord after renter shared it.");
  }

  const approveDecision = await api(`/api/workspace/queue/${linkedCase.id}/decision`, {
    method: "POST",
    token: landlordToken,
    body: {
      decision: "APPROVED",
      note: "Smoke readiness approval"
    }
  });
  assertStatus(approveDecision, 200, "Approve renter decision");

  const behaviourReview = await api(`/api/workspace/queue/${linkedCase.id}/behaviour-review`, {
    method: "POST",
    token: landlordToken,
    body: {
      propertyMaintenanceRating: "GOOD",
      leaseComplianceRating: "GOOD",
      note: "Smoke readiness behaviour review",
      complaints: []
    }
  });
  assertStatus(behaviourReview, 200, "Submit behaviour review");

  const landlordReferenceRequest = await api(`/api/renter/linked-cases/${renterLinkedCase.id}/request-landlord-reference`, {
    method: "POST",
    token: renterToken,
    body: {
      note: "Smoke readiness landlord reference request"
    }
  });
  assertStatus(landlordReferenceRequest, 200, "Request landlord reference");

  const landlordQueueItem = await api<{ landlordReferenceRequests: Array<{ id: string }> }>(`/api/workspace/queue/${linkedCase.id}`, {
    token: landlordToken
  });
  assertStatus(landlordQueueItem, 200, "Queue item with landlord reference request");

  const referenceRequest = landlordQueueItem.body.landlordReferenceRequests[0];
  if (!referenceRequest) {
    throw new Error("Landlord reference request was not returned for the landlord.");
  }

  const respondReference = await api(`/api/workspace/landlord-reference-requests/${referenceRequest.id}/respond`, {
    method: "POST",
    token: landlordToken,
    body: {
      recommendation: "RECOMMEND",
      note: "Smoke readiness landlord reference"
    }
  });
  assertStatus(respondReference, 200, "Respond to landlord reference request");

  const createSchedule = await api(`/api/workspace/queue/${linkedCase.id}/payment-schedules`, {
    method: "POST",
    token: landlordToken,
    body: {
      paymentType: "RENT",
      amountNgn: 1200000,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      note: "Smoke readiness rent schedule"
    }
  });
  assertStatus(createSchedule, 201, "Create payment schedule");

  const renterAfterSchedule = await api<{ linkedCases: Array<{ id: string; paymentSchedules: Array<{ id: string; paymentEvidenceObjectKey: string | null; confirmationInitiatedAt: string | null }> }> }>(
    "/api/renter/dashboard",
    { token: renterToken }
  );
  assertStatus(renterAfterSchedule, 200, "Renter dashboard after schedule creation");

  const renterCaseAfterSchedule = renterAfterSchedule.body.linkedCases.find((item) => item.id === renterLinkedCase.id);
  const renterSchedule = renterCaseAfterSchedule?.paymentSchedules[0];
  if (!renterSchedule) {
    throw new Error("Payment schedule was not visible to the renter.");
  }

  const initiateProof = await api(`/api/renter/payment-schedules/${renterSchedule.id}/initiate`, {
    method: "POST",
    token: renterToken,
    body: {
      receiptReference: `SMOKE-${timestamp}`,
      note: "Smoke readiness proof upload",
      paymentEvidenceObjectKey: `smoke-tests/${timestamp}/payment-proof.jpg`,
      paymentEvidenceFileName: "payment-proof.jpg",
      paymentEvidenceMimeType: "image/jpeg",
      paymentEvidenceFileSize: 1024
    }
  });
  assertStatus(initiateProof, 200, "Initiate renter payment proof");

  const initiateProofAgain = await api(`/api/renter/payment-schedules/${renterSchedule.id}/initiate`, {
    method: "POST",
    token: renterToken,
    body: {
      receiptReference: `SMOKE-${timestamp}-2`,
      note: "Repeat proof should fail",
      paymentEvidenceObjectKey: `smoke-tests/${timestamp}/payment-proof-2.jpg`,
      paymentEvidenceFileName: "payment-proof-2.jpg",
      paymentEvidenceMimeType: "image/jpeg",
      paymentEvidenceFileSize: 1024
    }
  });
  assertStatus(initiateProofAgain, 400, "Repeat proof submission blocked");

  const confirmSchedule = await api(`/api/workspace/payment-schedules/${renterSchedule.id}/confirm`, {
    method: "POST",
    token: landlordToken,
    body: {
      note: "Smoke readiness payment confirmation"
    }
  });
  assertStatus(confirmSchedule, 200, "Landlord confirms payment schedule");

  console.log("Smoke readiness passed.");
  console.log(JSON.stringify({
    createdPropertyId: property.id,
    createdPropertyUnitId: propertyUnit.id,
    linkedCaseId: linkedCase.id,
    paymentScheduleId: renterSchedule.id
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("Smoke readiness failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
