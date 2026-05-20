import { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { db, rolesTable, rolePermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.includes(":")) {
    const [salt, hash] = storedHash.split(":");
    const derived = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
  }
  const legacyHash = crypto.createHash("sha256").update(password).digest("hex");
  return legacyHash === storedHash;
}

export function createToken(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 7 })).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): any {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  if (signature !== expected) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  (req as any).userId = payload.userId;
  (req as any).userRole = payload.role;
  next();
}

export function adminOnly(req: Request, res: Response, next: NextFunction): void {
  // Both `admin` and `owner` are administrative roles. The owner role
  // was added with the new RBAC system and carries the same default
  // permission set as admin.
  const role = (req as any).userRole;
  if (role !== "admin" && role !== "owner") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function managerOrAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = (req as any).userRole;
  if (role !== "admin" && role !== "manager" && role !== "owner") {
    res.status(403).json({ error: "Manager or admin access required" });
    return;
  }
  next();
}

// ------------------------------------------------------------------
// Permission-based middleware
// ------------------------------------------------------------------
//
// In-process cache of role-name -> Set<permissionKey>. Invalidated by
// bumpRolePermissionCache() from roles.ts on any role mutation.
// owner & admin bypass the lookup and are treated as having every
// permission.
const rolePermCache = new Map<string, Set<string>>();

export function bumpRolePermissionCache(roleName?: string): void {
  if (roleName) rolePermCache.delete(roleName);
  else rolePermCache.clear();
}

async function loadRolePerms(roleName: string): Promise<Set<string>> {
  const cached = rolePermCache.get(roleName);
  if (cached) return cached;
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.name, roleName));
  if (!role) {
    const empty = new Set<string>();
    rolePermCache.set(roleName, empty);
    return empty;
  }
  const rows = await db
    .select({ permissionKey: rolePermissionsTable.permissionKey })
    .from(rolePermissionsTable)
    .where(eq(rolePermissionsTable.roleId, role.id));
  const set = new Set(rows.map((r) => r.permissionKey));
  rolePermCache.set(roleName, set);
  return set;
}

export function requirePermission(key: string) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const role = (req as any).userRole as string | undefined;
    if (!role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (role === "owner" || role === "admin") {
      next();
      return;
    }
    try {
      const perms = await loadRolePerms(role);
      if (!perms.has(key)) {
        res.status(403).json({ error: `Permission required: ${key}` });
        return;
      }
      next();
    } catch (err) {
      res.status(500).json({ error: "Permission check failed" });
    }
  };
}
