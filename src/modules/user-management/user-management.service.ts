import bcrypt from "bcryptjs";
import type { AdminRole, Prisma, PublicAccountStatus, UserStatus } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { requestPasswordReset, resendPublicAccountVerification } from "../auth/auth.service";

export type UserManagementType = "RENTER" | "LANDLORD" | "AGENT" | "ADMIN";
export type UserManagementStatus = PublicAccountStatus | UserStatus;
export type VerificationStatus = "VERIFIED" | "UNVERIFIED" | "PENDING" | "FAILED";
export type AdminPermission = "VIEW" | "EDIT" | "STATUS" | "ROLE" | "ADMIN_MANAGE";

const adminRolePermissions: Record<AdminRole, AdminPermission[]> = {
  SUPER_ADMIN: ["VIEW", "EDIT", "STATUS", "ROLE", "ADMIN_MANAGE"],
  ADMIN: ["VIEW", "EDIT", "STATUS", "ROLE"],
  SUPPORT_ADMIN: ["VIEW", "EDIT", "STATUS"],
  READ_ONLY_ADMIN: ["VIEW"]
};

export async function requireAdminPermission(actorUserId: string, permission: AdminPermission) {
  const actor = await prisma.user.findUnique({ where: { id: actorUserId } });
  if (!actor || actor.role !== "ADMIN" || actor.status !== "ACTIVE") {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }

  const role = actor.adminRole ?? "ADMIN";
  if (!adminRolePermissions[role].includes(permission)) {
    throw new AppError("This admin role cannot perform that action", 403, "FORBIDDEN");
  }

  return { ...actor, adminRole: role };
}

type ManagedUser = {
  id: string;
  source: "PUBLIC" | "STAFF";
  name: string;
  userType: UserManagementType;
  email: string;
  phone: string;
  verificationStatus: VerificationStatus;
  accountStatus: UserManagementStatus;
  dateRegistered: Date;
  lastLogin: Date | null;
  adminRole?: AdminRole | null;
};

function publicName(account: { firstName: string; lastName: string; organizationName: string | null }) {
  return account.organizationName?.trim() || [account.firstName, account.lastName].filter(Boolean).join(" ") || "Unnamed user";
}

function verificationStatus(account: { emailVerifiedAt: Date | null; identityReviewStatus: string }) : VerificationStatus {
  if (account.identityReviewStatus === "PENDING") return "PENDING";
  if (account.identityReviewStatus === "FAILED") return "FAILED";
  return account.emailVerifiedAt ? "VERIFIED" : "UNVERIFIED";
}

function sortUsers(items: ManagedUser[], sortBy: string, sortDir: "asc" | "desc") {
  const direction = sortDir === "asc" ? 1 : -1;
  return items.sort((left, right) => {
    const leftValue = sortBy === "name" ? left.name : sortBy === "email" ? left.email : sortBy === "type" ? left.userType : sortBy === "status" ? left.accountStatus : left.dateRegistered.getTime();
    const rightValue = sortBy === "name" ? right.name : sortBy === "email" ? right.email : sortBy === "type" ? right.userType : sortBy === "status" ? right.accountStatus : right.dateRegistered.getTime();
    return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true }) * direction;
  });
}

export async function listManagedUsers(input: {
  q?: string;
  userType?: UserManagementType;
  status?: UserManagementStatus;
  verificationStatus?: VerificationStatus;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}) {
  const query = input.q?.trim().toLowerCase();
  const publicWhere: Prisma.PublicAccountWhereInput = {
    ...(input.userType && input.userType !== "ADMIN" ? { accountType: input.userType } : input.userType === "ADMIN" ? { email: "__admin_filter_no_public_account__@invalid" } : {}),
    ...(input.status && ["UNVERIFIED", "ACTIVE", "DISABLED", "SUSPENDED", "BLOCKED"].includes(input.status) ? { status: input.status as PublicAccountStatus } : {}),
    ...(query ? { OR: [{ id: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }, { phone: { contains: query, mode: "insensitive" } }, { firstName: { contains: query, mode: "insensitive" } }, { lastName: { contains: query, mode: "insensitive" } }, { organizationName: { contains: query, mode: "insensitive" } }] } : {})
  };
  const staffWhere: Prisma.UserWhereInput = {
    role: "ADMIN",
    ...(input.userType && input.userType !== "ADMIN" ? { email: "__public_filter_no_admin__@invalid" } : {}),
    ...(input.status && ["ACTIVE", "DISABLED", "SUSPENDED", "BLOCKED"].includes(input.status) ? { status: input.status as UserStatus } : {}),
    ...(query ? { OR: [{ id: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }, { fullName: { contains: query, mode: "insensitive" } }] } : {})
  };

  const [accounts, staff] = await Promise.all([
    prisma.publicAccount.findMany({ where: publicWhere, select: { id: true, firstName: true, lastName: true, organizationName: true, accountType: true, email: true, phone: true, emailVerifiedAt: true, identityReviewStatus: true, status: true, createdAt: true, lastLoginAt: true } }),
    prisma.user.findMany({ where: staffWhere, select: { id: true, fullName: true, email: true, role: true, adminRole: true, status: true, createdAt: true, lastLoginAt: true } })
  ]);

  let items: ManagedUser[] = [
    ...accounts.map((account) => ({ id: account.id, source: "PUBLIC" as const, name: publicName(account), userType: account.accountType, email: account.email, phone: account.phone, verificationStatus: verificationStatus(account), accountStatus: account.status, dateRegistered: account.createdAt, lastLogin: account.lastLoginAt })),
    ...staff.map((user) => ({ id: user.id, source: "STAFF" as const, name: user.fullName, userType: "ADMIN" as const, email: user.email, phone: "-", verificationStatus: "VERIFIED" as const, accountStatus: user.status, dateRegistered: user.createdAt, lastLogin: user.lastLoginAt, adminRole: user.adminRole ?? "ADMIN" }))
  ];

  if (input.verificationStatus) items = items.filter((item) => item.verificationStatus === input.verificationStatus);
  sortUsers(items, input.sortBy ?? "dateRegistered", input.sortDir ?? "desc");
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100);
  const page = Math.max(input.page ?? 1, 1);
  const total = items.length;
  const counts = {
    totalUsers: total,
    renters: items.filter((item) => item.userType === "RENTER").length,
    landlords: items.filter((item) => item.userType === "LANDLORD").length,
    agents: items.filter((item) => item.userType === "AGENT").length,
    admins: items.filter((item) => item.userType === "ADMIN").length,
    active: items.filter((item) => item.accountStatus === "ACTIVE").length,
    suspended: items.filter((item) => item.accountStatus === "SUSPENDED").length
  };

  return { items: items.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total, totalPages: Math.max(Math.ceil(total / pageSize), 1) }, counts };
}

export async function getManagedUser(id: string) {
  const staff = await prisma.user.findUnique({ where: { id }, include: { adminNotes: { include: { author: { select: { fullName: true } } }, orderBy: { createdAt: "desc" } }, auditLogs: { orderBy: { createdAt: "desc" }, take: 50 } } });
  if (staff?.role === "ADMIN") {
    return { id: staff.id, source: "STAFF" as const, name: staff.fullName, userType: "ADMIN" as const, email: staff.email, phone: "-", verificationStatus: "VERIFIED" as const, accountStatus: staff.status, dateRegistered: staff.createdAt, lastLogin: staff.lastLoginAt, adminRole: staff.adminRole ?? "ADMIN", profile: { fullName: staff.fullName }, account: { role: staff.role, adminRole: staff.adminRole ?? "ADMIN", status: staff.status }, documents: [], activity: {}, notes: staff.adminNotes, auditHistory: staff.auditLogs };
  }

  const account = await prisma.publicAccount.findUnique({ where: { id }, include: { documents: { orderBy: { createdAt: "desc" } }, adminNotes: { include: { author: { select: { fullName: true } } }, orderBy: { createdAt: "desc" } } } });
  if (!account) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  const [auditHistory, propertyCount, caseCount, paymentCount, scoreEventCount] = await Promise.all([
    prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.propertyMember.count({ where: { publicAccountId: id } }),
    prisma.proposedRenter.count({ where: { renterAccountId: id } }),
    prisma.paymentSchedule.count({ where: { proposedRenter: { renterAccountId: id } } }),
    prisma.rentScoreEvent.count({ where: { publicAccountId: id } })
  ]);
  return { id: account.id, source: "PUBLIC" as const, name: publicName(account), userType: account.accountType, email: account.email, phone: account.phone, verificationStatus: verificationStatus(account), accountStatus: account.status, dateRegistered: account.createdAt, lastLogin: account.lastLoginAt, profile: { firstName: account.firstName, lastName: account.lastName, organizationName: account.organizationName, phone: account.phone, address: account.address, city: account.city, state: account.state }, account: { accountType: account.accountType, entityType: account.entityType, status: account.status, emailVerifiedAt: account.emailVerifiedAt, acceptedTermsAt: account.acceptedTermsAt }, verification: { emailVerifiedAt: account.emailVerifiedAt, identityReviewStatus: account.identityReviewStatus, identitySubmittedAt: account.identitySubmittedAt, identityReviewedAt: account.identityReviewedAt, identityReviewComment: account.identityReviewComment }, activity: { propertyCount, caseCount, paymentCount, scoreEventCount }, documents: account.documents.map((document) => ({ id: document.id, documentType: document.documentType, fileName: document.fileName, mimeType: document.mimeType, fileSize: document.fileSize, createdAt: document.createdAt })), notes: account.adminNotes, auditHistory };
}

export async function updateManagedUser(id: string, input: { fullName?: string; firstName?: string; lastName?: string; organizationName?: string | null; phone?: string; address?: string; city?: string; state?: string; notes?: string | null }) {
  const staff = await prisma.user.findUnique({ where: { id } });
  if (staff?.role === "ADMIN") return prisma.user.update({ where: { id }, data: { fullName: input.fullName?.trim() || undefined }, select: { id: true, fullName: true, email: true, role: true, status: true, adminRole: true } });
  const account = await prisma.publicAccount.findUnique({ where: { id } });
  if (!account) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  return prisma.publicAccount.update({ where: { id }, data: { firstName: input.firstName?.trim() || undefined, lastName: input.lastName?.trim() || undefined, organizationName: input.organizationName === undefined ? undefined : input.organizationName?.trim() || null, phone: input.phone?.trim() || undefined, address: input.address?.trim() || undefined, city: input.city?.trim() || undefined, state: input.state?.trim() || undefined, notes: input.notes === undefined ? undefined : input.notes?.trim() || null }, select: { id: true, firstName: true, lastName: true, organizationName: true, email: true, status: true, accountType: true } });
}

export async function changeManagedUserStatus(id: string, action: "ACTIVATE" | "DEACTIVATE" | "SUSPEND" | "UNSUSPEND" | "BLOCK") {
  const staff = await prisma.user.findUnique({ where: { id } });
  const nextStatus = action === "ACTIVATE" || action === "UNSUSPEND" ? "ACTIVE" : action === "DEACTIVATE" ? "DISABLED" : action === "SUSPEND" ? "SUSPENDED" : "BLOCKED";
  if (staff?.role === "ADMIN") return prisma.user.update({ where: { id }, data: { status: nextStatus as UserStatus }, select: { id: true, status: true, adminRole: true } });
  const account = await prisma.publicAccount.findUnique({ where: { id } });
  if (!account) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  return prisma.publicAccount.update({ where: { id }, data: { status: nextStatus as PublicAccountStatus }, select: { id: true, status: true, accountType: true } });
}

export async function changeAdminRole(id: string, adminRole: AdminRole) {
  const user = await prisma.user.findFirst({ where: { id, role: "ADMIN" } });
  if (!user) throw new AppError("Admin user not found", 404, "USER_NOT_FOUND");
  return prisma.user.update({ where: { id }, data: { adminRole }, select: { id: true, fullName: true, email: true, role: true, adminRole: true, status: true } });
}

export async function createAdmin(input: { fullName: string; email: string; password: string; adminRole: AdminRole }) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.create({ data: { fullName: input.fullName.trim(), email: input.email.trim().toLowerCase(), passwordHash, role: "ADMIN", adminRole: input.adminRole, status: "ACTIVE" }, select: { id: true, fullName: true, email: true, role: true, adminRole: true, status: true } });
}

export async function addAdminNote(id: string, authorUserId: string, note: string) {
  const staff = await prisma.user.findUnique({ where: { id, role: "ADMIN" } });
  if (staff) return prisma.adminNote.create({ data: { userId: id, authorUserId, note: note.trim() }, include: { author: { select: { fullName: true } } } });
  const account = await prisma.publicAccount.findUnique({ where: { id } });
  if (!account) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  return prisma.adminNote.create({ data: { publicAccountId: id, authorUserId, note: note.trim() }, include: { author: { select: { fullName: true } } } });
}

export async function resendManagedUserVerification(id: string) {
  const account = await prisma.publicAccount.findUnique({ where: { id } });
  if (!account) throw new AppError("Only public accounts have email verification", 400, "VALIDATION_ERROR");
  return resendPublicAccountVerification(account.email);
}

export async function sendManagedUserPasswordReset(id: string) {
  const staff = await prisma.user.findUnique({ where: { id } });
  const account = staff?.role === "ADMIN" ? staff : await prisma.publicAccount.findUnique({ where: { id } });
  if (!account) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  return requestPasswordReset(account.email);
}
