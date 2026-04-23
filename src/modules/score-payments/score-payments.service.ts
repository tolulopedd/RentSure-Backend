import type { Prisma, RentScorePaymentProvider, RentScorePaymentStatus } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { logger } from "../../common/logger/logger";
import { env } from "../../config/env";
import { getWorkspaceQueueItem } from "../workspace/workspace.service";

type DbClient = Prisma.TransactionClient | typeof prisma;

function normalizePath(path?: string) {
  if (!path?.trim()) return "/account/decisions";
  const value = path.trim();
  if (!value.startsWith("/")) {
    throw new AppError("Invalid callback path", 400, "VALIDATION_ERROR");
  }
  return value;
}

function buildCallbackUrl(path: string, reference: string) {
  const base = env.APP_WEB_BASE_URL.replace(/\/+$/, "");
  const separator = path.includes("?") ? "&" : "?";
  return `${base}${path}${separator}rentScorePaymentRef=${encodeURIComponent(reference)}`;
}

function makeReference(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readJson(response: Response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
}

async function getAccessibleProposedRenter(publicAccountId: string, proposedRenterId: string, tx: DbClient = prisma) {
  const proposedRenter = await tx.proposedRenter.findFirst({
    where: {
      id: proposedRenterId,
      property: {
        members: {
          some: {
            publicAccountId
          }
        }
      }
    },
    include: {
      property: true,
      requestedBy: true
    }
  });

  if (!proposedRenter) {
    throw new AppError("Proposed renter not found", 404, "PROPOSED_RENTER_NOT_FOUND");
  }

  return proposedRenter;
}

async function getRequester(publicAccountId: string, tx: DbClient = prisma) {
  const account = await tx.publicAccount.findUnique({
    where: { id: publicAccountId }
  });

  if (!account || account.status !== "ACTIVE") {
    throw new AppError("Workspace account not found", 404, "WORKSPACE_ACCOUNT_NOT_FOUND");
  }

  if (account.accountType !== "LANDLORD" && account.accountType !== "AGENT") {
    throw new AppError("Only landlord or agent accounts can request a rent score", 403, "FORBIDDEN");
  }

  return account;
}

async function getRenterBuyer(publicAccountId: string, tx: DbClient = prisma) {
  const account = await tx.publicAccount.findUnique({
    where: { id: publicAccountId }
  });

  if (!account || account.status !== "ACTIVE") {
    throw new AppError("Renter account not found", 404, "RENTER_NOT_FOUND");
  }

  if (account.accountType !== "RENTER") {
    throw new AppError("Only renter accounts can buy their own rent score", 403, "FORBIDDEN");
  }

  return account;
}

async function ensureScoreRequestCanStart(tx: DbClient, proposedRenterId: string) {
  const [existingScoreRequest, existingPayment] = await Promise.all([
    tx.scoreRequest.findFirst({
      where: { proposedRenterId },
      select: { id: true }
    }),
    tx.rentScorePayment.findFirst({
      where: {
        proposedRenterId,
        status: {
          in: ["PENDING", "PENDING_ACTION", "AWAITING_MANUAL_CONFIRMATION", "SUCCEEDED"]
        }
      },
      orderBy: { createdAt: "desc" }
    })
  ]);

  if (existingScoreRequest) {
    throw new AppError("Rent score has already been requested for this renter", 400, "VALIDATION_ERROR");
  }

  if (existingPayment?.status === "SUCCEEDED") {
    throw new AppError("A paid rent score request is already waiting to be processed", 400, "VALIDATION_ERROR");
  }

  if (existingPayment?.status === "PENDING_ACTION" || existingPayment?.status === "AWAITING_MANUAL_CONFIRMATION") {
    throw new AppError("A rent score payment is already in progress for this renter", 400, "VALIDATION_ERROR");
  }
}

async function createPaidScoreRequest(tx: DbClient, payment: {
  id: string;
  proposedRenterId: string;
  requestedByAccountId: string;
  notes?: string | null;
}) {
  const scoreRequest = await tx.scoreRequest.create({
    data: {
      proposedRenterId: payment.proposedRenterId,
      requestedByAccountId: payment.requestedByAccountId,
      notes: payment.notes || null,
      status: "REQUESTED"
    }
  });

  await tx.proposedRenterActivity.create({
    data: {
      proposedRenterId: payment.proposedRenterId,
      actorAccountId: payment.requestedByAccountId,
      activityType: "SCORE_REQUESTED",
      message: "Rent score review requested for this renter.",
      metadata: payment.notes ? ({ note: payment.notes } as Prisma.JsonObject) : undefined
    }
  });

  await tx.proposedRenter.update({
    where: { id: payment.proposedRenterId },
    data: { status: "SCORE_REQUESTED" }
  });

  await tx.rentScorePayment.update({
    where: { id: payment.id },
    data: {
      scoreRequestId: scoreRequest.id,
      status: "SUCCEEDED",
      verifiedAt: new Date()
    }
  });

  return scoreRequest;
}

function getManualTransferInstructions(reference: string) {
  const hasConfiguredManualTransfer =
    Boolean(env.RENT_SCORE_MANUAL_BANK_NAME) &&
    Boolean(env.RENT_SCORE_MANUAL_ACCOUNT_NAME) &&
    Boolean(env.RENT_SCORE_MANUAL_ACCOUNT_NUMBER);

  if (!hasConfiguredManualTransfer) {
    if (process.env.NODE_ENV === "production") {
      throw new AppError("Manual transfer has not been configured yet", 503, "FEATURE_NOT_READY");
    }

    logger.warn(
      { event: "rent_score.manual_transfer.using_dev_defaults", reference },
      "Manual transfer config is missing. Using local development defaults."
    );

    return {
      bankName: "Demo Bank",
      accountName: "RentSure Demo Account",
      accountNumber: "0001234567",
      reference,
      instructions:
        "Local development mode: use this reference for testing only. Add RENT_SCORE_MANUAL_* env vars to replace these defaults."
    };
  }

  return {
    bankName: env.RENT_SCORE_MANUAL_BANK_NAME,
    accountName: env.RENT_SCORE_MANUAL_ACCOUNT_NAME,
    accountNumber: env.RENT_SCORE_MANUAL_ACCOUNT_NUMBER,
    reference,
    instructions:
      env.RENT_SCORE_MANUAL_INSTRUCTIONS ||
      "Use the transfer reference exactly as shown so the admin team can confirm your payment quickly."
  };
}

async function initializePaystackPayment(input: {
  email: string;
  amountNgn: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}) {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new AppError("Paystack is not configured yet", 503, "FEATURE_NOT_READY");
  }

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`
    },
    body: JSON.stringify({
      email: input.email,
      amount: String(input.amountNgn * 100),
      currency: "NGN",
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata
    })
  });

  const payload = await readJson(response);
  if (!response.ok || !payload || typeof payload !== "object" || !("data" in payload)) {
    logger.error({ event: "paystack.initialize_failed", payload, status: response.status }, "Paystack initialize failed");
    throw new AppError("Unable to start Paystack checkout right now", 502, "PAYMENT_GATEWAY_ERROR");
  }

  const data = (payload as { data?: { authorization_url?: string; reference?: string } }).data;
  if (!data?.authorization_url || !data.reference) {
    throw new AppError("Paystack checkout did not return a payment link", 502, "PAYMENT_GATEWAY_ERROR");
  }

  return {
    checkoutUrl: data.authorization_url,
    gatewayReference: data.reference
  };
}

async function verifyPaystackPayment(reference: string, expectedAmountNgn: number) {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new AppError("Paystack is not configured yet", 503, "FEATURE_NOT_READY");
  }

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`
    }
  });

  const payload = await readJson(response);
  if (!response.ok || !payload || typeof payload !== "object" || !("data" in payload)) {
    logger.error({ event: "paystack.verify_failed", payload, status: response.status }, "Paystack verify failed");
    throw new AppError("Unable to verify Paystack payment right now", 502, "PAYMENT_GATEWAY_ERROR");
  }

  const data = (payload as { data?: { status?: string; reference?: string; amount?: number; paid_at?: string } }).data;
  const success = data?.status === "success" && data.reference === reference && Number(data.amount || 0) >= expectedAmountNgn * 100;

  return {
    success,
    paidAt: data?.paid_at ? new Date(data.paid_at) : new Date(),
    gatewayReference: data?.reference || reference,
    rawPayload: payload
  };
}

async function initializeFlutterwavePayment(input: {
  email: string;
  name: string;
  phone: string;
  amountNgn: number;
  reference: string;
  callbackUrl: string;
}) {
  if (!env.FLUTTERWAVE_SECRET_KEY) {
    throw new AppError("Flutterwave is not configured yet", 503, "FEATURE_NOT_READY");
  }

  const response = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.FLUTTERWAVE_SECRET_KEY}`
    },
    body: JSON.stringify({
      tx_ref: input.reference,
      amount: input.amountNgn,
      currency: "NGN",
      redirect_url: input.callbackUrl,
      customer: {
        email: input.email,
        name: input.name,
        phonenumber: input.phone
      },
      customizations: {
        title: "RentSure rent score request",
        description: "Payment for renter rent score review"
      }
    })
  });

  const payload = await readJson(response);
  if (!response.ok || !payload || typeof payload !== "object" || !("data" in payload)) {
    logger.error({ event: "flutterwave.initialize_failed", payload, status: response.status }, "Flutterwave initialize failed");
    throw new AppError("Unable to start Flutterwave checkout right now", 502, "PAYMENT_GATEWAY_ERROR");
  }

  const data = (payload as { data?: { link?: string } }).data;
  if (!data?.link) {
    throw new AppError("Flutterwave checkout did not return a payment link", 502, "PAYMENT_GATEWAY_ERROR");
  }

  return {
    checkoutUrl: data.link,
    gatewayReference: input.reference
  };
}

async function verifyFlutterwavePayment(reference: string, expectedAmountNgn: number) {
  if (!env.FLUTTERWAVE_SECRET_KEY) {
    throw new AppError("Flutterwave is not configured yet", 503, "FEATURE_NOT_READY");
  }

  const search = new URLSearchParams({ tx_ref: reference });
  const response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?${search.toString()}`, {
    headers: {
      Authorization: `Bearer ${env.FLUTTERWAVE_SECRET_KEY}`
    }
  });

  const payload = await readJson(response);
  if (!response.ok || !payload || typeof payload !== "object" || !("data" in payload)) {
    logger.error({ event: "flutterwave.verify_failed", payload, status: response.status }, "Flutterwave verify failed");
    throw new AppError("Unable to verify Flutterwave payment right now", 502, "PAYMENT_GATEWAY_ERROR");
  }

  const data = (payload as { data?: { status?: string; tx_ref?: string; amount?: number; currency?: string; created_at?: string } }).data;
  const success =
    data?.status === "successful" &&
    data.tx_ref === reference &&
    (data.currency || "NGN") === "NGN" &&
    Number(data.amount || 0) >= expectedAmountNgn;

  return {
    success,
    paidAt: data?.created_at ? new Date(data.created_at) : new Date(),
    gatewayReference: data?.tx_ref || reference,
    rawPayload: payload
  };
}

export async function createRentScorePaymentSession(input: {
  publicAccountId: string;
  proposedRenterId: string;
  provider: RentScorePaymentProvider;
  notes?: string;
  callbackPath?: string;
}) {
  const callbackPath = normalizePath(input.callbackPath);

  return prisma.$transaction(async (tx) => {
    const [requester, proposedRenter] = await Promise.all([
      getRequester(input.publicAccountId, tx),
      getAccessibleProposedRenter(input.publicAccountId, input.proposedRenterId, tx)
    ]);

    await ensureScoreRequestCanStart(tx, proposedRenter.id);

    const reference = makeReference("rentscore");
    const callbackUrl = buildCallbackUrl(callbackPath, reference);
    const payment = await tx.rentScorePayment.create({
      data: {
        proposedRenterId: proposedRenter.id,
        requestedByAccountId: input.publicAccountId,
        provider: input.provider,
        amountNgn: env.RENT_SCORE_REQUEST_AMOUNT_NGN,
        reference,
        callbackUrl,
        notes: input.notes?.trim() || null,
        status: input.provider === "MANUAL_TRANSFER" ? "AWAITING_MANUAL_CONFIRMATION" : "PENDING_ACTION"
      }
    });

    if (input.provider === "MANUAL_TRANSFER") {
      const instructions = getManualTransferInstructions(reference);
      await tx.rentScorePayment.update({
        where: { id: payment.id },
        data: {
          manualTransferReference: reference,
          metadata: instructions as Prisma.JsonObject
        }
      });

      return {
        paymentId: payment.id,
        provider: input.provider,
        status: "AWAITING_MANUAL_CONFIRMATION" as RentScorePaymentStatus,
        amountNgn: env.RENT_SCORE_REQUEST_AMOUNT_NGN,
        currency: "NGN",
        reference,
        checkoutUrl: null,
        manualTransfer: instructions
      };
    }

    const fullName = proposedRenter.organizationName || [proposedRenter.firstName, proposedRenter.lastName].filter(Boolean).join(" ");
    const initializer =
      input.provider === "PAYSTACK"
        ? initializePaystackPayment({
            email: requester.email,
            amountNgn: env.RENT_SCORE_REQUEST_AMOUNT_NGN,
            reference,
            callbackUrl,
            metadata: {
              purpose: "RENT_SCORE_REQUEST",
              proposedRenterId: proposedRenter.id,
              requestedByAccountId: input.publicAccountId
            }
          })
        : initializeFlutterwavePayment({
            email: requester.email,
            name: fullName || requester.email,
            phone: requester.phone,
            amountNgn: env.RENT_SCORE_REQUEST_AMOUNT_NGN,
            reference,
            callbackUrl
          });

    const initialized = await initializer;
    await tx.rentScorePayment.update({
      where: { id: payment.id },
      data: {
        checkoutUrl: initialized.checkoutUrl,
        gatewayReference: initialized.gatewayReference
      }
    });

    return {
      paymentId: payment.id,
      provider: input.provider,
      status: "PENDING_ACTION" as RentScorePaymentStatus,
      amountNgn: env.RENT_SCORE_REQUEST_AMOUNT_NGN,
      currency: "NGN",
      reference,
      checkoutUrl: initialized.checkoutUrl,
      manualTransfer: null
    };
  });
}

export async function createRenterRentScorePaymentSession(input: {
  publicAccountId: string;
  provider: RentScorePaymentProvider;
  callbackPath?: string;
}) {
  const callbackPath = normalizePath(input.callbackPath || "/account/renter/buy-score");

  return prisma.$transaction(async (tx) => {
    const renter = await getRenterBuyer(input.publicAccountId, tx);
    const existingPayment = await tx.rentScorePayment.findFirst({
      where: {
        requestedByAccountId: input.publicAccountId,
        proposedRenterId: null,
        status: {
          in: ["PENDING_ACTION", "AWAITING_MANUAL_CONFIRMATION"]
        }
      },
      orderBy: { createdAt: "desc" }
    });

    if (existingPayment?.status === "PENDING_ACTION" || existingPayment?.status === "AWAITING_MANUAL_CONFIRMATION") {
      throw new AppError("A rent score payment is already in progress", 400, "VALIDATION_ERROR");
    }

    const reference = makeReference("selfscore");
    const callbackUrl = buildCallbackUrl(callbackPath, reference);
    const payment = await tx.rentScorePayment.create({
      data: {
        proposedRenterId: null,
        requestedByAccountId: input.publicAccountId,
        provider: input.provider,
        amountNgn: env.RENT_SCORE_REQUEST_AMOUNT_NGN,
        reference,
        callbackUrl,
        status: input.provider === "MANUAL_TRANSFER" ? "AWAITING_MANUAL_CONFIRMATION" : "PENDING_ACTION",
        metadata: {
          purpose: "SELF_SERVICE_RENT_SCORE"
        } as Prisma.JsonObject
      }
    });

    if (input.provider === "MANUAL_TRANSFER") {
      const instructions = getManualTransferInstructions(reference);
      await tx.rentScorePayment.update({
        where: { id: payment.id },
        data: {
          manualTransferReference: reference,
          metadata: {
            purpose: "SELF_SERVICE_RENT_SCORE",
            ...instructions
          } as Prisma.JsonObject
        }
      });

      return {
        paymentId: payment.id,
        provider: input.provider,
        status: "AWAITING_MANUAL_CONFIRMATION" as RentScorePaymentStatus,
        amountNgn: env.RENT_SCORE_REQUEST_AMOUNT_NGN,
        currency: "NGN",
        reference,
        checkoutUrl: null,
        manualTransfer: instructions
      };
    }

    const fullName = renter.organizationName || [renter.firstName, renter.lastName].filter(Boolean).join(" ");
    const initialized =
      input.provider === "PAYSTACK"
        ? await initializePaystackPayment({
            email: renter.email,
            amountNgn: env.RENT_SCORE_REQUEST_AMOUNT_NGN,
            reference,
            callbackUrl,
            metadata: {
              purpose: "SELF_SERVICE_RENT_SCORE",
              publicAccountId: input.publicAccountId
            }
          })
        : await initializeFlutterwavePayment({
            email: renter.email,
            name: fullName || renter.email,
            phone: renter.phone,
            amountNgn: env.RENT_SCORE_REQUEST_AMOUNT_NGN,
            reference,
            callbackUrl
          });

    await tx.rentScorePayment.update({
      where: { id: payment.id },
      data: {
        checkoutUrl: initialized.checkoutUrl,
        gatewayReference: initialized.gatewayReference
      }
    });

    return {
      paymentId: payment.id,
      provider: input.provider,
      status: "PENDING_ACTION" as RentScorePaymentStatus,
      amountNgn: env.RENT_SCORE_REQUEST_AMOUNT_NGN,
      currency: "NGN",
      reference,
      checkoutUrl: initialized.checkoutUrl,
      manualTransfer: null
    };
  });
}

export async function verifyRentScorePayment(input: {
  publicAccountId: string;
  reference: string;
}) {
  const payment = await prisma.rentScorePayment.findFirst({
    where: {
      reference: input.reference,
      proposedRenter: {
        property: {
          members: {
            some: {
              publicAccountId: input.publicAccountId
            }
          }
        }
      }
    }
  });

  if (!payment) {
    throw new AppError("Rent score payment not found", 404, "RENT_SCORE_PAYMENT_NOT_FOUND");
  }

  if (!payment.proposedRenterId) {
    throw new AppError("This payment is not linked to a landlord rent score request", 400, "VALIDATION_ERROR");
  }
  const proposedRenterId = payment.proposedRenterId;

  if (payment.status === "SUCCEEDED" && payment.scoreRequestId) {
    return getWorkspaceQueueItem(input.publicAccountId, proposedRenterId);
  }

  if (payment.provider === "MANUAL_TRANSFER") {
    throw new AppError("Manual transfer is awaiting admin confirmation", 400, "VALIDATION_ERROR");
  }

  const verification =
    payment.provider === "PAYSTACK"
      ? await verifyPaystackPayment(payment.reference, payment.amountNgn)
      : await verifyFlutterwavePayment(payment.reference, payment.amountNgn);

  if (!verification.success) {
    await prisma.rentScorePayment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        gatewayReference: verification.gatewayReference,
        metadata: verification.rawPayload as Prisma.JsonObject
      }
    });
    throw new AppError("Payment was not completed successfully", 400, "PAYMENT_NOT_COMPLETED");
  }

  await prisma.$transaction(async (tx) => {
    const refreshedPayment = await tx.rentScorePayment.findUniqueOrThrow({
      where: { id: payment.id }
    });

    if (refreshedPayment.status !== "SUCCEEDED" || !refreshedPayment.scoreRequestId) {
      await tx.rentScorePayment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCEEDED",
          paidAt: verification.paidAt,
          verifiedAt: new Date(),
          gatewayReference: verification.gatewayReference,
          metadata: verification.rawPayload as Prisma.JsonObject
        }
      });

      await createPaidScoreRequest(tx, {
        id: payment.id,
        proposedRenterId,
        requestedByAccountId: payment.requestedByAccountId,
        notes: payment.notes
      });
    }
  });

  return getWorkspaceQueueItem(input.publicAccountId, proposedRenterId);
}

export async function verifyRenterRentScorePayment(input: {
  publicAccountId: string;
  reference: string;
}) {
  const payment = await prisma.rentScorePayment.findFirst({
    where: {
      reference: input.reference,
      requestedByAccountId: input.publicAccountId,
      proposedRenterId: null
    }
  });

  if (!payment) {
    throw new AppError("Rent score payment not found", 404, "RENT_SCORE_PAYMENT_NOT_FOUND");
  }

  if (payment.status === "SUCCEEDED") {
    return { success: true };
  }

  if (payment.provider === "MANUAL_TRANSFER") {
    throw new AppError("Manual transfer is awaiting admin confirmation", 400, "VALIDATION_ERROR");
  }

  const verification =
    payment.provider === "PAYSTACK"
      ? await verifyPaystackPayment(payment.reference, payment.amountNgn)
      : await verifyFlutterwavePayment(payment.reference, payment.amountNgn);

  if (!verification.success) {
    await prisma.rentScorePayment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        gatewayReference: verification.gatewayReference,
        metadata: verification.rawPayload as Prisma.JsonObject
      }
    });
    throw new AppError("Payment was not completed successfully", 400, "PAYMENT_NOT_COMPLETED");
  }

  await prisma.rentScorePayment.update({
    where: { id: payment.id },
    data: {
      status: "SUCCEEDED",
      paidAt: verification.paidAt,
      verifiedAt: new Date(),
      gatewayReference: verification.gatewayReference,
      metadata: verification.rawPayload as Prisma.JsonObject
    }
  });

  return { success: true };
}

export async function listManualRentScorePayments() {
  const items = await prisma.rentScorePayment.findMany({
    where: {
      provider: "MANUAL_TRANSFER",
      status: "AWAITING_MANUAL_CONFIRMATION"
    },
    include: {
      proposedRenter: {
        include: {
          property: true
        }
      },
      requestedBy: true
    },
    orderBy: { createdAt: "desc" }
  });

  return {
    items: items.map((item) => ({
      id: item.id,
      reference: item.reference,
      amountNgn: item.amountNgn,
      currency: item.currency,
      createdAt: item.createdAt,
      notes: item.notes,
      requestedBy: {
        id: item.requestedBy.id,
        name: item.requestedBy.organizationName || `${item.requestedBy.firstName} ${item.requestedBy.lastName}`.trim(),
        email: item.requestedBy.email
      },
      renter: {
        id: item.proposedRenter?.id || item.requestedBy.id,
        name: item.proposedRenter
          ? item.proposedRenter.organizationName || `${item.proposedRenter.firstName} ${item.proposedRenter.lastName}`.trim()
          : item.requestedBy.organizationName || `${item.requestedBy.firstName} ${item.requestedBy.lastName}`.trim(),
        email: item.proposedRenter?.email || item.requestedBy.email
      },
      property: {
        id: item.proposedRenter?.property.id || item.id,
        name: item.proposedRenter?.property.name || "Self-service rent score purchase",
        address: item.proposedRenter?.property.address || "No property linked",
        city: item.proposedRenter?.property.city || "-",
        state: item.proposedRenter?.property.state || "-"
      }
    }))
  };
}

export async function confirmManualRentScorePayment(input: {
  adminUserId: string;
  paymentId: string;
}) {
  const payment = await prisma.rentScorePayment.findUnique({
    where: { id: input.paymentId }
  });

  if (!payment || payment.provider !== "MANUAL_TRANSFER") {
    throw new AppError("Manual rent score payment not found", 404, "RENT_SCORE_PAYMENT_NOT_FOUND");
  }

  if (payment.status !== "AWAITING_MANUAL_CONFIRMATION") {
    throw new AppError("This manual payment no longer needs confirmation", 400, "VALIDATION_ERROR");
  }

  await prisma.$transaction(async (tx) => {
    await tx.rentScorePayment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCEEDED",
        paidAt: new Date(),
        verifiedAt: new Date(),
        confirmedAt: new Date(),
        confirmedByUserId: input.adminUserId
      }
    });

    if (payment.proposedRenterId) {
      await createPaidScoreRequest(tx, {
        id: payment.id,
        proposedRenterId: payment.proposedRenterId,
        requestedByAccountId: payment.requestedByAccountId,
        notes: payment.notes
      });
    }
  });

  return { success: true };
}
