import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, timeClockTable, employeesTable, shiftsTable, inAppNotificationsTable } from "@workspace/db";
import { authMiddleware, adminOnly, managerOrAdmin } from "../lib/auth";

const router: IRouter = Router();

// ─── TIME CLOCK ──────────────────────────────────────────────────────────────

router.get("/timeclock", authMiddleware, async (req, res): Promise<void> => {
  try {
    const { date, employeeId } = req.query as any;
    const conditions: any[] = [];
    if (date) conditions.push(eq(timeClockTable.clockDate, date));
    if (employeeId) conditions.push(eq(timeClockTable.employeeId, Number(employeeId)));
    const records = await db.select({
      id: timeClockTable.id,
      employeeId: timeClockTable.employeeId,
      employeeName: employeesTable.name,
      employeeCode: employeesTable.code,
      shiftId: timeClockTable.shiftId,
      clockDate: timeClockTable.clockDate,
      clockIn: timeClockTable.clockIn,
      clockOut: timeClockTable.clockOut,
      lateFlag: timeClockTable.lateFlag,
      earlyDepartureFlag: timeClockTable.earlyDepartureFlag,
      overtimeMinutes: timeClockTable.overtimeMinutes,
      overtimeApproved: timeClockTable.overtimeApproved,
      notes: timeClockTable.notes,
    }).from(timeClockTable)
      .leftJoin(employeesTable, eq(timeClockTable.employeeId, employeesTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined as any)
      .orderBy(desc(timeClockTable.clockDate));
    res.json(records);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/timeclock/clock-in", authMiddleware, async (req, res): Promise<void> => {
  try {
    const { employeeId, shiftId, notes } = req.body;
    if (!employeeId) { res.status(400).json({ error: "employeeId is required" }); return; }
    const today = new Date().toISOString().split("T")[0];
    // Check if already clocked in today
    const existing = await db.select().from(timeClockTable)
      .where(and(eq(timeClockTable.employeeId, employeeId), eq(timeClockTable.clockDate, today)));
    if (existing.length > 0 && existing[0].clockIn && !existing[0].clockOut) {
      res.status(400).json({ error: "Already clocked in for today" }); return;
    }
    // Check for late flag (if shift assigned)
    let lateFlag = false;
    if (shiftId) {
      const [shift] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, shiftId));
      if (shift) {
        const now = new Date();
        const [sh, sm] = shift.startTime.split(":").map(Number);
        const shiftStart = new Date(now);
        shiftStart.setHours(sh, sm, 0, 0);
        lateFlag = now > shiftStart;
      }
    }
    let record;
    if (existing.length > 0) {
      [record] = await db.update(timeClockTable)
        .set({ clockIn: new Date(), lateFlag, shiftId, notes })
        .where(eq(timeClockTable.id, existing[0].id))
        .returning();
    } else {
      [record] = await db.insert(timeClockTable).values({
        employeeId, shiftId, clockDate: today,
        clockIn: new Date(), lateFlag, notes,
      }).returning();
    }
    res.status(201).json(record);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/timeclock/clock-out", authMiddleware, async (req, res): Promise<void> => {
  try {
    const { employeeId } = req.body;
    if (!employeeId) { res.status(400).json({ error: "employeeId is required" }); return; }
    const today = new Date().toISOString().split("T")[0];
    const [existing] = await db.select().from(timeClockTable)
      .where(and(eq(timeClockTable.employeeId, employeeId), eq(timeClockTable.clockDate, today)));
    if (!existing || !existing.clockIn) {
      res.status(400).json({ error: "No active clock-in found for today" }); return;
    }
    const now = new Date();
    const clockInTime = new Date(existing.clockIn);
    const workedMinutes = Math.floor((now.getTime() - clockInTime.getTime()) / 60000);
    const overtimeMinutes = Math.max(0, workedMinutes - 480); // 8 hours = 480 min
    const [record] = await db.update(timeClockTable)
      .set({ clockOut: now, overtimeMinutes })
      .where(eq(timeClockTable.id, existing.id))
      .returning();
    res.json({ ...record, workedMinutes, overtimeMinutes });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/timeclock/:id/approve-overtime", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [record] = await db.update(timeClockTable)
      .set({ overtimeApproved: true, overtimeApprovedBy: (req as any).userId })
      .where(eq(timeClockTable.id, id))
      .returning();
    res.json(record);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── IN-APP NOTIFICATIONS ─────────────────────────────────────────────────────

router.get("/in-app-notifications", authMiddleware, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId;
    const userRole = (req as any).userRole;
    const notifications = await db.select().from(inAppNotificationsTable)
      .where(
        sql`(user_id = ${userId} OR user_id IS NULL) AND (role IS NULL OR role = ${userRole})`
      )
      .orderBy(desc(inAppNotificationsTable.createdAt))
      .limit(50);
    const unreadCount = notifications.filter(n => !n.readAt).length;
    res.json({ notifications, unreadCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/in-app-notifications/:id/read", authMiddleware, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await db.update(inAppNotificationsTable)
      .set({ readAt: new Date() })
      .where(eq(inAppNotificationsTable.id, id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/in-app-notifications/mark-all-read", authMiddleware, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId;
    const userRole = (req as any).userRole;
    await db.update(inAppNotificationsTable)
      .set({ readAt: new Date() })
      .where(sql`(user_id = ${userId} OR user_id IS NULL) AND (role IS NULL OR role = ${userRole}) AND read_at IS NULL`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Helper to create notification (used by other routes)
export async function createInAppNotification(data: {
  userId?: number; role?: string; type?: string; title: string; body: string; link?: string;
}): Promise<void> {
  try {
    await db.insert(inAppNotificationsTable).values({
      userId: data.userId || null,
      role: data.role || null,
      type: data.type || "info",
      title: data.title,
      body: data.body,
      link: data.link || null,
    });
  } catch {}
}

export default router;
