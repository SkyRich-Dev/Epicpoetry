import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { ListUsersResponse, CreateUserBody, UpdateUserBody, UpdateUserParams } from "@workspace/api-zod";
import { hashPassword, authMiddleware, adminOnly } from "../lib/auth";

const router: IRouter = Router();

router.get("/users", authMiddleware, adminOnly, async (_req, res): Promise<void> => {
  const users = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    fullName: usersTable.fullName,
    email: usersTable.email,
    role: usersTable.role,
    active: usersTable.active,
    createdAt: usersTable.createdAt,
  }).from(usersTable);
  res.json(ListUsersResponse.parse(users));
});

router.post("/users", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.insert(usersTable).values({
    username: parsed.data.username,
    passwordHash: hashPassword(parsed.data.password),
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    role: parsed.data.role,
    active: parsed.data.active ?? true,
  }).returning();

  res.status(201).json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
  });
});

router.patch("/users/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: any = {};
  if (parsed.data.fullName) updates.fullName = parsed.data.fullName;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;
  if (parsed.data.role) updates.role = parsed.data.role;
  if (parsed.data.active !== undefined) updates.active = parsed.data.active;
  if (parsed.data.password) updates.passwordHash = hashPassword(parsed.data.password);

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
  });
});

router.delete("/users/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const requestingUserId = (req as any).userId;
  if (requestingUserId === params.data.id) {
    res.status(400).json({ error: "You cannot delete your own account" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  res.json({ success: true });
});

export default router;
