import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, rolesTable, rolePermissionsTable, usersTable } from "@workspace/db";
import { authMiddleware, adminOnly, bumpRolePermissionCache } from "../lib/auth";
import {
  PERMISSION_CATEGORIES,
  ALL_PERMISSION_KEYS,
  isValidPermissionKey,
  BUILT_IN_ROLES,
} from "../lib/permissions";

const router: IRouter = Router();

/** Public catalog of permissions grouped by feature category. */
router.get("/permissions", authMiddleware, (_req, res) => {
  res.json({
    categories: PERMISSION_CATEGORIES,
    allKeys: ALL_PERMISSION_KEYS,
  });
});

async function loadRoleWithPermissions(roleId: number) {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId));
  if (!role) return null;
  const perms = await db
    .select({ permissionKey: rolePermissionsTable.permissionKey })
    .from(rolePermissionsTable)
    .where(eq(rolePermissionsTable.roleId, roleId));
  const userCount = (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, role.name))).length;
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isBuiltIn: role.isBuiltIn,
    permissions: perms.map((p) => p.permissionKey),
    userCount,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

router.get("/roles", authMiddleware, async (_req, res) => {
  const roles = await db.select().from(rolesTable);
  const allPerms = await db.select().from(rolePermissionsTable);
  const allUsers = await db.select({ role: usersTable.role }).from(usersTable);
  const result = roles
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isBuiltIn: r.isBuiltIn,
      permissions: allPerms.filter((p) => p.roleId === r.id).map((p) => p.permissionKey),
      userCount: allUsers.filter((u) => u.role === r.name).length,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
    .sort((a, b) => {
      // built-in first, then alphabetical
      if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  res.json(result);
});

router.post("/roles", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { name, description, permissions } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Role name is required" });
    return;
  }
  const cleanName = name.trim().toLowerCase().replace(/\s+/g, "_");
  const existing = await db.select().from(rolesTable).where(eq(rolesTable.name, cleanName));
  if (existing.length > 0) {
    res.status(409).json({ error: "A role with that name already exists" });
    return;
  }
  const perms: string[] = Array.isArray(permissions) ? permissions.filter(isValidPermissionKey) : [];
  const [role] = await db.insert(rolesTable).values({
    name: cleanName,
    description: description || null,
    isBuiltIn: false,
  }).returning();
  if (perms.length > 0) {
    await db.insert(rolePermissionsTable).values(perms.map((p) => ({ roleId: role.id, permissionKey: p })));
  }
  bumpRolePermissionCache(cleanName);
  res.status(201).json(await loadRoleWithPermissions(role.id));
});

router.patch("/roles/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid role id" }); return; }
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, id));
  if (!role) { res.status(404).json({ error: "Role not found" }); return; }

  const { description, permissions } = req.body || {};
  const updates: any = {};
  if (description !== undefined) updates.description = description;
  if (Object.keys(updates).length > 0) {
    await db.update(rolesTable).set(updates).where(eq(rolesTable.id, id));
  }

  if (Array.isArray(permissions)) {
    const next = new Set<string>(permissions.filter(isValidPermissionKey));

    // Last-`roles.edit` holder protection: refuse a save that would
    // leave zero users able to manage roles. `owner` and `admin` are
    // always treated as having every permission (see requirePermission),
    // so any role with users assigned where name is owner/admin counts
    // as a holder regardless of stored perms.
    if (!next.has("roles.edit")) {
      const allRoles = await db.select().from(rolesTable);
      const allPerms = await db.select().from(rolePermissionsTable);
      const allUsers = await db.select({ role: usersTable.role }).from(usersTable);
      const otherHoldersUserCount = allRoles
        .filter((r) => r.id !== id)
        .filter((r) =>
          r.name === "owner" ||
          r.name === "admin" ||
          allPerms.some((p) => p.roleId === r.id && p.permissionKey === "roles.edit")
        )
        .reduce((sum, r) => sum + allUsers.filter((u) => u.role === r.name).length, 0);
      if (otherHoldersUserCount === 0) {
        res.status(409).json({
          error:
            "Refused: this change would leave zero users able to manage roles. Grant roles.edit to another role with at least one user first.",
        });
        return;
      }
    }

    await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, id));
    if (next.size > 0) {
      await db.insert(rolePermissionsTable).values(
        [...next].map((p) => ({ roleId: id, permissionKey: p }))
      );
    }
  }

  bumpRolePermissionCache(role.name);
  res.json(await loadRoleWithPermissions(id));
});

router.delete("/roles/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid role id" }); return; }
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, id));
  if (!role) { res.status(404).json({ error: "Role not found" }); return; }
  if (role.isBuiltIn) {
    res.status(400).json({ error: "Built-in roles cannot be deleted" });
    return;
  }
  const usersWithRole = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, role.name));
  if (usersWithRole.length > 0) {
    res.status(400).json({ error: `Cannot delete: ${usersWithRole.length} user(s) currently use this role. Reassign them first.` });
    return;
  }
  await db.delete(rolesTable).where(eq(rolesTable.id, id));
  bumpRolePermissionCache(role.name);
  res.json({ success: true });
});

/**
 * Idempotent seed: ensure every BUILT_IN_ROLES entry EXISTS with its
 * default permission set on first creation.
 *
 * Important: for roles that already exist we leave both the role row
 * AND its permission set ALONE. The owner can tune built-in roles from
 * the Roles UI, and we must not silently revert those edits on reboot.
 *
 * If an owner deliberately wants to "reset" a built-in role to its
 * shipped defaults, they can delete it (or we can add an explicit
 * "reset" button later) and the next seed will recreate it.
 */
/**
 * Permissions added AFTER initial seed that we want to back-fill onto
 * existing built-in roles without wiping owner customisations. Each
 * entry lists which built-in roles SHOULD have the new key. The seed
 * adds missing rows only — it never deletes.
 */
const ADDITIVE_BACKFILL: { key: string; roles: string[] }[] = [
  { key: "menu_items.view_margin", roles: ["owner", "admin", "accountant"] },
  { key: "dashboard.view_pnl",     roles: ["owner", "admin", "accountant"] },
];

export async function seedBuiltInRoles() {
  for (const def of BUILT_IN_ROLES) {
    const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.name, def.name));
    if (existing) {
      // Already present — never mutate the existing permission set.
      // We do, however, back-fill brand-new permission keys onto the
      // built-ins so that newly-shipped features have a sensible
      // default without owners needing to manually tick boxes.
      const existingPerms = await db
        .select({ permissionKey: rolePermissionsTable.permissionKey })
        .from(rolePermissionsTable)
        .where(eq(rolePermissionsTable.roleId, existing.id));
      const have = new Set(existingPerms.map((p) => p.permissionKey));
      const toAdd: string[] = [];
      for (const bf of ADDITIVE_BACKFILL) {
        if (!bf.roles.includes(def.name)) continue;
        // Owner/admin defaults are "*" — they should always carry every key.
        const shouldHave =
          def.permissions === "*" ? true : (def.permissions as string[]).includes(bf.key);
        if (shouldHave && !have.has(bf.key)) toAdd.push(bf.key);
      }
      if (toAdd.length > 0) {
        await db.insert(rolePermissionsTable).values(
          toAdd.map((k) => ({ roleId: existing.id, permissionKey: k }))
        );
        bumpRolePermissionCache(def.name);
      }
      continue;
    }

    const [role] = await db.insert(rolesTable).values({
      name: def.name,
      description: def.description,
      isBuiltIn: true,
    }).returning();

    const wantKeys: string[] =
      def.permissions === "*" ? ALL_PERMISSION_KEYS : def.permissions;

    if (wantKeys.length > 0) {
      await db.insert(rolePermissionsTable).values(
        wantKeys.map((k) => ({ roleId: role.id, permissionKey: k }))
      );
    }
  }
}

/** Look up the effective permission set for a given user role name. */
export async function getEffectivePermissionsForRole(roleName: string): Promise<string[]> {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.name, roleName));
  if (!role) return [];
  const perms = await db
    .select({ permissionKey: rolePermissionsTable.permissionKey })
    .from(rolePermissionsTable)
    .where(eq(rolePermissionsTable.roleId, role.id));
  return perms.map((p) => p.permissionKey);
}

export default router;
