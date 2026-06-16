import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, restaurantTablesTable, tableSessionsTable, tableReservationsTable } from "@workspace/db";
import { authMiddleware, managerOrAdmin } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";

const router: IRouter = Router();

// ─── Tables CRUD ─────────────────────────────────────────────────────────────

router.get("/tables", authMiddleware, async (req, res): Promise<void> => {
  try {
    const tables = await db.select().from(restaurantTablesTable).where(eq(restaurantTablesTable.active, true));
    res.json(tables);
  } catch (e: any) {
    res.status(500).json({ error: "Failed to load tables" });
  }
});

router.post("/tables", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const { name, section = "Indoor", capacity = 4, tableType = "square", displayX = 0, displayY = 0 } = req.body;
    if (!name) { res.status(400).json({ error: "Table name is required" }); return; }
    const [table] = await db.insert(restaurantTablesTable).values({
      name, section, capacity, tableType, displayX, displayY, status: "free",
    }).returning();
    await createAuditLog("tables", table.id, "create", null, table, String((req as any).userId));
    res.status(201).json(table);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/tables/:id", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { name, section, capacity, tableType, displayX, displayY, status, active } = req.body;
    const update: any = {};
    if (name !== undefined) update.name = name;
    if (section !== undefined) update.section = section;
    if (capacity !== undefined) update.capacity = capacity;
    if (tableType !== undefined) update.tableType = tableType;
    if (displayX !== undefined) update.displayX = displayX;
    if (displayY !== undefined) update.displayY = displayY;
    if (status !== undefined) update.status = status;
    if (active !== undefined) update.active = active;
    const [updated] = await db.update(restaurantTablesTable).set(update).where(eq(restaurantTablesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Table not found" }); return; }
    await createAuditLog("tables", id, "update", null, update, String((req as any).userId));
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/tables/:id", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await db.update(restaurantTablesTable).set({ active: false }).where(eq(restaurantTablesTable.id, id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Table Sessions ───────────────────────────────────────────────────────────

router.get("/tables/:id/sessions", authMiddleware, async (req, res): Promise<void> => {
  try {
    const tableId = Number(req.params.id);
    const sessions = await db.select().from(tableSessionsTable)
      .where(eq(tableSessionsTable.tableId, tableId))
      .orderBy(desc(tableSessionsTable.openedAt));
    res.json(sessions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/tables/:id/open-session", authMiddleware, async (req, res): Promise<void> => {
  try {
    const tableId = Number(req.params.id);
    const { coverCount = 1, invoiceId, notes } = req.body;
    const [session] = await db.insert(tableSessionsTable).values({
      tableId, coverCount, invoiceId, notes,
      openedBy: (req as any).userId,
    }).returning();
    // Mark table as occupied
    await db.update(restaurantTablesTable).set({ status: "occupied" }).where(eq(restaurantTablesTable.id, tableId));
    res.status(201).json(session);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/table-sessions/:id/close", authMiddleware, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [session] = await db.update(tableSessionsTable)
      .set({ closedAt: new Date() })
      .where(eq(tableSessionsTable.id, id))
      .returning();
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    // Mark table free
    await db.update(restaurantTablesTable).set({ status: "free" }).where(eq(restaurantTablesTable.id, session.tableId));
    res.json(session);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Reservations ─────────────────────────────────────────────────────────────

router.get("/reservations", authMiddleware, async (req, res): Promise<void> => {
  try {
    const reservations = await db.select().from(tableReservationsTable)
      .orderBy(desc(tableReservationsTable.createdAt));
    res.json(reservations);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/reservations", authMiddleware, async (req, res): Promise<void> => {
  try {
    const { tableId, guestName, guestPhone, partySize, reservedAt, notes } = req.body;
    if (!guestName || !reservedAt) { res.status(400).json({ error: "Guest name and reservation time required" }); return; }
    const [reservation] = await db.insert(tableReservationsTable).values({
      tableId, guestName, guestPhone, partySize: partySize || 1, reservedAt, notes,
      status: "pending", createdBy: (req as any).userId,
    }).returning();
    // Mark table reserved if tableId provided
    if (tableId) {
      await db.update(restaurantTablesTable).set({ status: "reserved" }).where(eq(restaurantTablesTable.id, tableId));
    }
    res.status(201).json(reservation);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/reservations/:id", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { status, guestName, guestPhone, partySize, notes, reservedAt, tableId } = req.body;
    const update: any = {};
    if (status !== undefined) update.status = status;
    if (guestName !== undefined) update.guestName = guestName;
    if (guestPhone !== undefined) update.guestPhone = guestPhone;
    if (partySize !== undefined) update.partySize = partySize;
    if (notes !== undefined) update.notes = notes;
    if (reservedAt !== undefined) update.reservedAt = reservedAt;
    if (tableId !== undefined) update.tableId = tableId;
    const [updated] = await db.update(tableReservationsTable).set(update).where(eq(tableReservationsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Reservation not found" }); return; }
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/reservations/:id", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await db.delete(tableReservationsTable).where(eq(tableReservationsTable.id, id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Aliases for frontend compatibility ──────────────────────────────────────

// POST /table-sessions — open a new table session
router.post("/table-sessions", authMiddleware, async (req, res): Promise<void> => {
  try {
    const { tableId, invoiceId, coverCount = 1, notes } = req.body;
    if (!tableId) { res.status(400).json({ error: "tableId is required" }); return; }
    const [session] = await db.insert(tableSessionsTable).values({
      tableId: Number(tableId), invoiceId: invoiceId ? Number(invoiceId) : undefined,
      coverCount: Number(coverCount), notes, openedBy: (req as any).userId,
    }).returning();
    // Mark table as occupied
    await db.update(restaurantTablesTable).set({ status: "occupied" }).where(eq(restaurantTablesTable.id, Number(tableId)));
    res.status(201).json(session);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Alias GET /table-reservations → /reservations
router.get("/table-reservations", authMiddleware, async (req, res): Promise<void> => {
  try {
    const reservations = await db.select().from(tableReservationsTable)
      .orderBy(desc(tableReservationsTable.createdAt));
    res.json(reservations);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Alias POST /table-reservations → create reservation
router.post("/table-reservations", authMiddleware, async (req, res): Promise<void> => {
  try {
    const { tableId, guestName, guestPhone, partySize = 1, reservedAt, notes, status = "pending" } = req.body;
    if (!guestName || !reservedAt) { res.status(400).json({ error: "guestName and reservedAt are required" }); return; }
    const [reservation] = await db.insert(tableReservationsTable).values({
      tableId: tableId ? Number(tableId) : undefined,
      guestName, guestPhone, partySize: Number(partySize),
      reservedAt, notes, status, createdBy: (req as any).userId,
    }).returning();
    res.status(201).json(reservation);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Alias PATCH /table-reservations/:id
router.patch("/table-reservations/:id", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { status, guestName, guestPhone, partySize, notes, reservedAt, tableId } = req.body;
    const update: any = {};
    if (status !== undefined) update.status = status;
    if (guestName !== undefined) update.guestName = guestName;
    if (guestPhone !== undefined) update.guestPhone = guestPhone;
    if (partySize !== undefined) update.partySize = partySize;
    if (notes !== undefined) update.notes = notes;
    if (reservedAt !== undefined) update.reservedAt = reservedAt;
    if (tableId !== undefined) update.tableId = tableId;
    const [updated] = await db.update(tableReservationsTable).set(update).where(eq(tableReservationsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Reservation not found" }); return; }
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
