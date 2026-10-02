import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/AppError";
import { writeAuditLog } from "../../common/audit/audit";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  addAdminNote,
  changeAdminRole,
  changeManagedUserStatus,
  createAdmin,
  getManagedUser,
  listManagedUsers,
  listCustomers,
  exportCustomers,
  requireAdminPermission,
  resendManagedUserVerification,
  sendManagedUserPasswordReset,
  updateManagedUser
} from "./user-management.service";

const router = Router();
const userTypeSchema = z.enum(["RENTER", "LANDLORD", "AGENT", "ADMIN"]);
const statusSchema = z.enum(["UNVERIFIED", "ACTIVE", "DISABLED", "SUSPENDED", "BLOCKED"]);
const verificationSchema = z.enum(["VERIFIED", "UNVERIFIED", "PENDING", "FAILED"]);
const adminRoleSchema = z.enum(["SUPER_ADMIN", "ADMIN", "SUPPORT_ADMIN", "READ_ONLY_ADMIN"]);
const customerTypeSchema = z.enum(["RENTER", "LANDLORD", "AGENT"]);

function parseError(error: unknown, fallback: string) {
  return error instanceof z.ZodError ? new AppError(error.issues[0]?.message ?? fallback, 400, "VALIDATION_ERROR") : error;
}

router.get("/admin/users", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "VIEW");
    const query = z.object({
      q: z.string().trim().max(120).optional(),
      userType: userTypeSchema.optional(),
      status: statusSchema.optional(),
      verificationStatus: verificationSchema.optional(),
      sortBy: z.enum(["name", "email", "type", "status", "dateRegistered"]).optional(),
      sortDir: z.enum(["asc", "desc"]).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional()
    }).parse(req.query);
    res.json(await listManagedUsers(query));
  } catch (error) {
    next(parseError(error, "Invalid user search"));
  }
});

router.get("/admin/customers", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "VIEW");
    const query = z.object({
      q: z.string().trim().max(120).optional(),
      customerType: customerTypeSchema.optional(),
      status: statusSchema.extract(["UNVERIFIED", "ACTIVE", "DISABLED", "SUSPENDED", "BLOCKED"]).optional(),
      sortBy: z.enum(["firstName", "lastName", "type", "email", "dateRegistered"]).optional(),
      sortDir: z.enum(["asc", "desc"]).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional()
    }).parse(req.query);
    res.json(await listCustomers(query));
  } catch (error) {
    next(parseError(error, "Invalid customer search"));
  }
});

router.get("/admin/customers/export", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "EXPORT");
    const query = z.object({
      q: z.string().trim().max(120).optional(),
      customerType: customerTypeSchema.optional(),
      status: statusSchema.extract(["UNVERIFIED", "ACTIVE", "DISABLED", "SUSPENDED", "BLOCKED"]).optional(),
      sortBy: z.enum(["firstName", "lastName", "type", "email", "dateRegistered"]).optional(),
      sortDir: z.enum(["asc", "desc"]).optional()
    }).parse(req.query);
    const csv = await exportCustomers(query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="rentsure-customers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\ufeff${csv}`);
  } catch (error) {
    next(parseError(error, "Unable to export customers"));
  }
});

router.get("/admin/users/:id", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "VIEW");
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    res.json(await getManagedUser(params.id));
  } catch (error) {
    next(parseError(error, "Invalid user request"));
  }
});

router.patch("/admin/users/:id", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "EDIT");
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const optionalText = (max: number, min = 0) => z.preprocess(
      (value) => value === "" ? undefined : value,
      z.string().trim().min(min).max(max).optional()
    );
    const body = z.object({
      fullName: z.string().trim().min(2).max(160).optional(),
      firstName: optionalText(80, 1),
      lastName: optionalText(80, 1),
      organizationName: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().max(160).nullable().optional()),
      phone: optionalText(40),
      address: optionalText(240),
      city: optionalText(100),
      state: optionalText(100),
      notes: z.string().trim().max(1000).nullable().optional()
    }).parse(req.body);
    const result = await updateManagedUser(params.id, body);
    await writeAuditLog({ req, action: "admin.user.update", entity: "UserManagement", entityId: params.id, meta: body });
    res.json(result);
  } catch (error) {
    next(parseError(error, "Invalid user update"));
  }
});

router.post("/admin/users/:id/status", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "STATUS");
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ action: z.enum(["ACTIVATE", "DEACTIVATE", "SUSPEND", "UNSUSPEND", "BLOCK"]), reason: z.string().trim().max(500).optional() }).parse(req.body);
    if (["DEACTIVATE", "SUSPEND", "BLOCK"].includes(body.action) && !body.reason) {
      throw new AppError("A reason is required for this status change", 400, "VALIDATION_ERROR");
    }
    if (params.id === req.user!.userId && ["DEACTIVATE", "SUSPEND", "BLOCK"].includes(body.action)) {
      throw new AppError("You cannot disable your own admin account", 400, "VALIDATION_ERROR");
    }
    const result = await changeManagedUserStatus(params.id, body.action);
    await writeAuditLog({ req, action: `admin.user.status.${body.action.toLowerCase()}`, entity: "UserManagement", entityId: params.id, meta: { reason: body.reason } });
    res.json(result);
  } catch (error) {
    next(parseError(error, "Invalid status change"));
  }
});

router.post("/admin/users/:id/resend-verification", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "EDIT");
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await resendManagedUserVerification(params.id);
    await writeAuditLog({ req, action: "admin.user.resend_verification", entity: "UserManagement", entityId: params.id });
    res.json(result);
  } catch (error) {
    next(parseError(error, "Unable to resend verification"));
  }
});

router.post("/admin/users/:id/send-password-reset", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "EDIT");
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await sendManagedUserPasswordReset(params.id);
    await writeAuditLog({ req, action: "admin.user.send_password_reset", entity: "UserManagement", entityId: params.id });
    res.json(result);
  } catch (error) {
    next(parseError(error, "Unable to send password reset"));
  }
});

router.patch("/admin/users/:id/admin-role", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "ROLE");
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ adminRole: adminRoleSchema }).parse(req.body);
    const result = await changeAdminRole(params.id, body.adminRole);
    await writeAuditLog({ req, action: "admin.role.change", entity: "User", entityId: params.id, meta: body });
    res.json(result);
  } catch (error) {
    next(parseError(error, "Invalid admin role change"));
  }
});

router.post("/admin/users/:id/notes", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "EDIT");
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ note: z.string().trim().min(1).max(2000) }).parse(req.body);
    const result = await addAdminNote(params.id, req.user!.userId, body.note);
    await writeAuditLog({ req, action: "admin.note.create", entity: "UserManagement", entityId: params.id, meta: { note: body.note } });
    res.status(201).json(result);
  } catch (error) {
    next(parseError(error, "Invalid admin note"));
  }
});

router.post("/admin/admins", requireAuth, async (req, res, next) => {
  try {
    await requireAdminPermission(req.user!.userId, "ADMIN_MANAGE");
    const body = z.object({ fullName: z.string().trim().min(2).max(160), email: z.string().trim().email(), password: z.string().min(6).regex(/[A-Z]/).regex(/[a-z]/), adminRole: adminRoleSchema.default("ADMIN") }).parse(req.body);
    const result = await createAdmin(body);
    await writeAuditLog({ req, action: "admin.account.create", entity: "User", entityId: result.id, meta: { email: result.email, adminRole: result.adminRole } });
    res.status(201).json(result);
  } catch (error) {
    next(parseError(error, "Invalid admin account"));
  }
});

export const userManagementRoutes = router;

