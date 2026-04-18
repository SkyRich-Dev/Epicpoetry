import { Router, type IRouter } from "express";
import { eq, and, like } from "drizzle-orm";
import { db, employeesTable, shiftsTable, attendanceTable, leavesTable, salaryRecordsTable, salaryAdvancesTable, salaryAdjustmentsTable, systemConfigTable } from "@workspace/db";
import { authMiddleware, adminOnly } from "../lib/auth";
import { generateCode } from "../lib/codeGenerator";
import { createAuditLog } from "../lib/audit";
import { validateNotFutureDate } from "../lib/dateValidation";
import multer from "multer";
import path from "path";
import fs from "fs";

const PROOF_DIR = path.join(process.cwd(), "uploads", "salary-proofs");
fs.mkdirSync(PROOF_DIR, { recursive: true });
const proofUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PROOF_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    cb(null, allowed.includes(file.mimetype));
  },
});

const router: IRouter = Router();

router.get("/employees", authMiddleware, async (req, res): Promise<void> => {
  const employees = await db.select().from(employeesTable).orderBy(employeesTable.name);
  const role = (req as any).userRole;
  if (role !== "admin") {
    res.json(employees.map(e => ({ id: e.id, code: e.code, name: e.name, position: e.position, employmentType: e.employmentType, active: e.active })));
    return;
  }
  res.json(employees);
});

router.post("/employees", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { name, contactNumber, position, salary, employmentType } = req.body;
  if (!name || !position) { res.status(400).json({ error: "Name and position are required" }); return; }
  const code = await generateCode("EMP", "employees");
  const [employee] = await db.insert(employeesTable).values({
    code, name, contactNumber: contactNumber || null, position, salary: salary || 0,
    employmentType: employmentType || "full-time",
  }).returning();
  await createAuditLog("employees", employee.id, "create", null, employee);
  res.json(employee);
});

router.patch("/employees/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { name, contactNumber, position, salary, employmentType, active } = req.body;
  const updates: any = {};
  if (name !== undefined) updates.name = name;
  if (contactNumber !== undefined) updates.contactNumber = contactNumber;
  if (position !== undefined) updates.position = position;
  if (salary !== undefined) updates.salary = salary;
  if (employmentType !== undefined) updates.employmentType = employmentType;
  if (active !== undefined) updates.active = active;
  const [employee] = await db.update(employeesTable).set(updates).where(eq(employeesTable.id, id)).returning();
  if (!employee) { res.status(404).json({ error: "Not found" }); return; }
  res.json(employee);
});

router.delete("/employees/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [employee] = await db.delete(employeesTable).where(eq(employeesTable.id, id)).returning();
  if (!employee) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

router.get("/shifts", authMiddleware, async (_req, res): Promise<void> => {
  const shifts = await db.select().from(shiftsTable).orderBy(shiftsTable.name);
  res.json(shifts);
});

router.post("/shifts", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { name, startTime, endTime } = req.body;
  if (!name || !startTime || !endTime) { res.status(400).json({ error: "Name, startTime, endTime required" }); return; }
  const [shift] = await db.insert(shiftsTable).values({ name, startTime, endTime }).returning();
  res.json(shift);
});

router.patch("/shifts/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const updates: any = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.startTime !== undefined) updates.startTime = req.body.startTime;
  if (req.body.endTime !== undefined) updates.endTime = req.body.endTime;
  if (req.body.active !== undefined) updates.active = req.body.active;
  const [shift] = await db.update(shiftsTable).set(updates).where(eq(shiftsTable.id, id)).returning();
  if (!shift) { res.status(404).json({ error: "Not found" }); return; }
  res.json(shift);
});

router.delete("/shifts/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [shift] = await db.delete(shiftsTable).where(eq(shiftsTable.id, id)).returning();
  if (!shift) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

router.get("/attendance", authMiddleware, async (req, res): Promise<void> => {
  const { date } = req.query;
  let records;
  if (date) {
    records = await db.select({
      id: attendanceTable.id,
      employeeId: attendanceTable.employeeId,
      employeeName: employeesTable.name,
      employeeCode: employeesTable.code,
      attendanceDate: attendanceTable.attendanceDate,
      shiftId: attendanceTable.shiftId,
      shiftName: shiftsTable.name,
      status: attendanceTable.status,
      markedBy: attendanceTable.markedBy,
      createdAt: attendanceTable.createdAt,
    }).from(attendanceTable)
      .leftJoin(employeesTable, eq(attendanceTable.employeeId, employeesTable.id))
      .leftJoin(shiftsTable, eq(attendanceTable.shiftId, shiftsTable.id))
      .where(eq(attendanceTable.attendanceDate, date as string))
      .orderBy(employeesTable.name);
  } else {
    records = await db.select({
      id: attendanceTable.id,
      employeeId: attendanceTable.employeeId,
      employeeName: employeesTable.name,
      employeeCode: employeesTable.code,
      attendanceDate: attendanceTable.attendanceDate,
      shiftId: attendanceTable.shiftId,
      shiftName: shiftsTable.name,
      status: attendanceTable.status,
      markedBy: attendanceTable.markedBy,
      createdAt: attendanceTable.createdAt,
    }).from(attendanceTable)
      .leftJoin(employeesTable, eq(attendanceTable.employeeId, employeesTable.id))
      .leftJoin(shiftsTable, eq(attendanceTable.shiftId, shiftsTable.id))
      .orderBy(attendanceTable.attendanceDate);
  }
  res.json(records);
});

router.post("/attendance", authMiddleware, async (req, res): Promise<void> => {
  const { employeeId, attendanceDate, shiftId, status } = req.body;
  if (!employeeId || !attendanceDate || !status) { res.status(400).json({ error: "employeeId, attendanceDate, status required" }); return; }
  const dateErr = validateNotFutureDate(attendanceDate, "Attendance date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }
  const existing = await db.select().from(attendanceTable).where(
    and(eq(attendanceTable.employeeId, employeeId), eq(attendanceTable.attendanceDate, attendanceDate))
  );
  if (existing.length > 0) {
    const [updated] = await db.update(attendanceTable).set({
      shiftId: shiftId || null, status, markedBy: (req as any).userId
    }).where(eq(attendanceTable.id, existing[0].id)).returning();
    res.json(updated);
    return;
  }
  const [record] = await db.insert(attendanceTable).values({
    employeeId, attendanceDate, shiftId: shiftId || null, status, markedBy: (req as any).userId,
  }).returning();
  res.json(record);
});

router.post("/attendance/bulk", authMiddleware, async (req, res): Promise<void> => {
  const { date, entries } = req.body;
  if (!date || !entries || !Array.isArray(entries)) { res.status(400).json({ error: "date and entries array required" }); return; }
  const bulkDateErr = validateNotFutureDate(date, "Attendance date");
  if (bulkDateErr) { res.status(400).json({ error: bulkDateErr }); return; }
  const results = [];
  for (const entry of entries) {
    const { employeeId, shiftId, status } = entry;
    if (!employeeId || !status) continue;
    const existing = await db.select().from(attendanceTable).where(
      and(eq(attendanceTable.employeeId, employeeId), eq(attendanceTable.attendanceDate, date))
    );
    if (existing.length > 0) {
      const [updated] = await db.update(attendanceTable).set({
        shiftId: shiftId || null, status, markedBy: (req as any).userId
      }).where(eq(attendanceTable.id, existing[0].id)).returning();
      results.push(updated);
    } else {
      const [record] = await db.insert(attendanceTable).values({
        employeeId, attendanceDate: date, shiftId: shiftId || null, status, markedBy: (req as any).userId,
      }).returning();
      results.push(record);
    }
  }
  res.json(results);
});

router.get("/leaves", authMiddleware, async (req, res): Promise<void> => {
  const { employeeId } = req.query;
  let query = db.select({
    id: leavesTable.id,
    employeeId: leavesTable.employeeId,
    employeeName: employeesTable.name,
    employeeCode: employeesTable.code,
    leaveDate: leavesTable.leaveDate,
    leaveType: leavesTable.leaveType,
    reason: leavesTable.reason,
    approvedBy: leavesTable.approvedBy,
    createdAt: leavesTable.createdAt,
  }).from(leavesTable)
    .leftJoin(employeesTable, eq(leavesTable.employeeId, employeesTable.id))
    .orderBy(leavesTable.leaveDate).$dynamic();

  if (employeeId) {
    query = query.where(eq(leavesTable.employeeId, Number(employeeId)));
  }
  const records = await query;
  res.json(records);
});

router.post("/leaves", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { employeeId, leaveDate, leaveType, reason } = req.body;
  if (!employeeId || !leaveDate || !leaveType) { res.status(400).json({ error: "employeeId, leaveDate, leaveType required" }); return; }
  const existing = await db.select().from(leavesTable).where(
    and(eq(leavesTable.employeeId, employeeId), eq(leavesTable.leaveDate, leaveDate))
  );
  if (existing.length > 0) {
    res.status(400).json({ error: "Leave already exists for this date" });
    return;
  }
  const [leave] = await db.insert(leavesTable).values({
    employeeId, leaveDate, leaveType, reason: reason || null, approvedBy: (req as any).userId,
  }).returning();
  res.json(leave);
});

router.delete("/leaves/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [leave] = await db.delete(leavesTable).where(eq(leavesTable.id, id)).returning();
  if (!leave) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

router.get("/salary", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const records = await db.select({
    id: salaryRecordsTable.id,
    employeeId: salaryRecordsTable.employeeId,
    employeeName: employeesTable.name,
    employeeCode: employeesTable.code,
    month: salaryRecordsTable.month,
    year: salaryRecordsTable.year,
    baseSalary: salaryRecordsTable.baseSalary,
    totalDaysInMonth: salaryRecordsTable.totalDaysInMonth,
    presentDays: salaryRecordsTable.presentDays,
    halfDays: salaryRecordsTable.halfDays,
    paidLeaves: salaryRecordsTable.paidLeaves,
    unpaidLeaves: salaryRecordsTable.unpaidLeaves,
    weekOffs: salaryRecordsTable.weekOffs,
    paidWeekOffs: salaryRecordsTable.paidWeekOffs,
    excessWeekOffs: salaryRecordsTable.excessWeekOffs,
    absentDays: salaryRecordsTable.absentDays,
    absentPenaltyMultiplier: salaryRecordsTable.absentPenaltyMultiplier,
    bonusAmount: salaryRecordsTable.bonusAmount,
    incentiveAmount: salaryRecordsTable.incentiveAmount,
    penaltyAmount: salaryRecordsTable.penaltyAmount,
    advanceDeducted: salaryRecordsTable.advanceDeducted,
    grossEarnings: salaryRecordsTable.grossEarnings,
    deductions: salaryRecordsTable.deductions,
    netSalary: salaryRecordsTable.netSalary,
    paymentStatus: salaryRecordsTable.paymentStatus,
    paymentProofUrl: salaryRecordsTable.paymentProofUrl,
    paidAt: salaryRecordsTable.paidAt,
    paidBy: salaryRecordsTable.paidBy,
    generatedAt: salaryRecordsTable.generatedAt,
  }).from(salaryRecordsTable)
    .leftJoin(employeesTable, eq(salaryRecordsTable.employeeId, employeesTable.id))
    .orderBy(salaryRecordsTable.year, salaryRecordsTable.month);
  res.json(records);
});

router.post("/salary/generate", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { month, year } = req.body;
  if (!month || !year) { res.status(400).json({ error: "month and year required" }); return; }

  const configs = await db.select().from(systemConfigTable);
  const config = configs[0] || { allowedWeekOffsPerMonth: 4, absentPenaltyMultiplier: 1 };
  const allowedWeekOffs = config.allowedWeekOffsPerMonth ?? 4;
  const absentMultiplier = config.absentPenaltyMultiplier ?? 1;

  const employees = await db.select().from(employeesTable).where(eq(employeesTable.active, true));
  const daysInMonth = new Date(year, month, 0).getDate();

  const results = [];
  for (const emp of employees) {
    try {
      const record = await db.transaction(async (tx) => {
        const existing = await tx.select().from(salaryRecordsTable).where(
          and(eq(salaryRecordsTable.employeeId, emp.id), eq(salaryRecordsTable.month, month), eq(salaryRecordsTable.year, year))
        );
        if (existing.length > 0) return null;

        const monthStr = String(month).padStart(2, "0");
        const datePrefix = `${year}-${monthStr}`;
        const monthAttendance = await tx.select().from(attendanceTable).where(
          and(eq(attendanceTable.employeeId, emp.id), like(attendanceTable.attendanceDate, `${datePrefix}%`))
        );
        const monthLeaves = await tx.select().from(leavesTable).where(
          and(eq(leavesTable.employeeId, emp.id), like(leavesTable.leaveDate, `${datePrefix}%`))
        );

        let presentDays = 0;
        let halfDays = 0;
        let weekOffs = 0;
        let absentDays = 0;
        for (const a of monthAttendance) {
          if (a.status === "present") presentDays++;
          else if (a.status === "half-day") { halfDays++; presentDays += 0.5; }
          else if (a.status === "week-off") weekOffs++;
          else if (a.status === "absent") absentDays++;
        }
        const paidLeaves = monthLeaves.filter(l => l.leaveType === "paid").length;
        const unpaidLeaves = monthLeaves.filter(l => l.leaveType === "unpaid").length;
        const perDay = emp.salary / daysInMonth;
        const paidWeekOffs = Math.min(weekOffs, allowedWeekOffs);
        const excessWeekOffs = Math.max(0, weekOffs - allowedWeekOffs);
        const halfDayDeduction = halfDays * 0.5 * perDay;
        const absentDeduction = absentDays * absentMultiplier * perDay;
        const excessWeekOffDeduction = excessWeekOffs * perDay;
        const unpaidLeaveDeduction = unpaidLeaves * perDay;

        const monthAdjustments = await tx.select().from(salaryAdjustmentsTable).where(
          and(eq(salaryAdjustmentsTable.employeeId, emp.id), eq(salaryAdjustmentsTable.month, month), eq(salaryAdjustmentsTable.year, year))
        );
        const bonusAmount = monthAdjustments.filter(a => a.type === "bonus").reduce((s, a) => s + Number(a.amount), 0);
        const incentiveAmount = monthAdjustments.filter(a => a.type === "incentive").reduce((s, a) => s + Number(a.amount), 0);
        const penaltyAmount = monthAdjustments.filter(a => a.type === "penalty").reduce((s, a) => s + Number(a.amount), 0);

        const pendingAdvances = await tx.select().from(salaryAdvancesTable).where(
          and(eq(salaryAdvancesTable.employeeId, emp.id), eq(salaryAdvancesTable.status, "pending"))
        );
        const advanceDeducted = pendingAdvances.reduce((s, a) => s + Number(a.amount), 0);

        const grossEarnings = emp.salary + bonusAmount + incentiveAmount;
        const deductions = halfDayDeduction + absentDeduction + excessWeekOffDeduction + unpaidLeaveDeduction + penaltyAmount + advanceDeducted;
        const netSalary = Math.max(0, grossEarnings - deductions);

        const [inserted] = await tx.insert(salaryRecordsTable).values({
          employeeId: emp.id, month, year, baseSalary: emp.salary,
          totalDaysInMonth: daysInMonth, presentDays, halfDays, paidLeaves, unpaidLeaves,
          weekOffs, paidWeekOffs, excessWeekOffs, absentDays,
          absentPenaltyMultiplier: absentMultiplier,
          bonusAmount: Math.round(bonusAmount * 100) / 100,
          incentiveAmount: Math.round(incentiveAmount * 100) / 100,
          penaltyAmount: Math.round(penaltyAmount * 100) / 100,
          advanceDeducted: Math.round(advanceDeducted * 100) / 100,
          grossEarnings: Math.round(grossEarnings * 100) / 100,
          deductions: Math.round(deductions * 100) / 100,
          netSalary: Math.round(netSalary * 100) / 100,
        }).returning();

        for (const adv of pendingAdvances) {
          await tx.update(salaryAdvancesTable).set({ status: "recovered", recoveredInSalaryId: inserted.id }).where(eq(salaryAdvancesTable.id, adv.id));
        }
        for (const adj of monthAdjustments) {
          await tx.update(salaryAdjustmentsTable).set({ appliedToSalaryId: inserted.id }).where(eq(salaryAdjustmentsTable.id, adj.id));
        }
        return inserted;
      });
      if (record) results.push(record);
    } catch (err: any) {
      if (!String(err?.code || err?.message || "").includes("23505")) {
        throw err;
      }
    }
  }
  res.json(results);
});

router.get("/salary-advances", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { employeeId, status } = req.query;
  let query = db.select({
    id: salaryAdvancesTable.id,
    employeeId: salaryAdvancesTable.employeeId,
    employeeName: employeesTable.name,
    employeeCode: employeesTable.code,
    advanceDate: salaryAdvancesTable.advanceDate,
    amount: salaryAdvancesTable.amount,
    reason: salaryAdvancesTable.reason,
    status: salaryAdvancesTable.status,
    recoveredInSalaryId: salaryAdvancesTable.recoveredInSalaryId,
    createdAt: salaryAdvancesTable.createdAt,
  }).from(salaryAdvancesTable)
    .leftJoin(employeesTable, eq(salaryAdvancesTable.employeeId, employeesTable.id))
    .orderBy(salaryAdvancesTable.advanceDate).$dynamic();
  const conditions = [];
  if (employeeId) conditions.push(eq(salaryAdvancesTable.employeeId, Number(employeeId)));
  if (status) conditions.push(eq(salaryAdvancesTable.status, status as string));
  if (conditions.length > 0) query = query.where(and(...conditions));
  const records = await query;
  res.json(records);
});

router.post("/salary-advances", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { employeeId, advanceDate, amount, reason } = req.body;
  if (!employeeId || !advanceDate || !amount) { res.status(400).json({ error: "employeeId, advanceDate, amount required" }); return; }
  const advDateErr = validateNotFutureDate(advanceDate, "Advance date");
  if (advDateErr) { res.status(400).json({ error: advDateErr }); return; }
  const amt = Number(amount);
  if (!isFinite(amt) || amt <= 0) { res.status(400).json({ error: "amount must be positive" }); return; }
  const [advance] = await db.insert(salaryAdvancesTable).values({
    employeeId, advanceDate, amount: amt, reason: reason || null, status: "pending", createdBy: (req as any).userId,
  }).returning();
  await createAuditLog("salary_advances", advance.id, "create", null, advance);
  res.json(advance);
});

router.patch("/salary-advances/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(salaryAdvancesTable).where(eq(salaryAdvancesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "recovered") { res.status(400).json({ error: "Recovered advances cannot be edited" }); return; }
  const updates: any = {};
  if (req.body.amount !== undefined) {
    const amt = Number(req.body.amount);
    if (!isFinite(amt) || amt <= 0) { res.status(400).json({ error: "amount must be positive" }); return; }
    updates.amount = amt;
  }
  if (req.body.advanceDate !== undefined) updates.advanceDate = req.body.advanceDate;
  if (req.body.reason !== undefined) updates.reason = req.body.reason;
  if (req.body.status !== undefined) {
    if (!["pending", "cancelled"].includes(req.body.status)) { res.status(400).json({ error: "Status can only be set to pending or cancelled here; recovered is set automatically by salary generation" }); return; }
    updates.status = req.body.status;
  }
  const [updated] = await db.update(salaryAdvancesTable).set(updates).where(eq(salaryAdvancesTable.id, id)).returning();
  res.json(updated);
});

router.delete("/salary-advances/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(salaryAdvancesTable).where(eq(salaryAdvancesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "recovered") { res.status(400).json({ error: "Cannot delete a recovered advance" }); return; }
  await db.delete(salaryAdvancesTable).where(eq(salaryAdvancesTable.id, id));
  res.json({ success: true });
});

router.get("/salary-adjustments", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { employeeId, month, year, type } = req.query;
  let query = db.select({
    id: salaryAdjustmentsTable.id,
    employeeId: salaryAdjustmentsTable.employeeId,
    employeeName: employeesTable.name,
    employeeCode: employeesTable.code,
    month: salaryAdjustmentsTable.month,
    year: salaryAdjustmentsTable.year,
    type: salaryAdjustmentsTable.type,
    amount: salaryAdjustmentsTable.amount,
    reason: salaryAdjustmentsTable.reason,
    appliedToSalaryId: salaryAdjustmentsTable.appliedToSalaryId,
    createdAt: salaryAdjustmentsTable.createdAt,
  }).from(salaryAdjustmentsTable)
    .leftJoin(employeesTable, eq(salaryAdjustmentsTable.employeeId, employeesTable.id))
    .orderBy(salaryAdjustmentsTable.year, salaryAdjustmentsTable.month).$dynamic();
  const conditions = [];
  if (employeeId) conditions.push(eq(salaryAdjustmentsTable.employeeId, Number(employeeId)));
  if (month) conditions.push(eq(salaryAdjustmentsTable.month, Number(month)));
  if (year) conditions.push(eq(salaryAdjustmentsTable.year, Number(year)));
  if (type) conditions.push(eq(salaryAdjustmentsTable.type, type as string));
  if (conditions.length > 0) query = query.where(and(...conditions));
  const records = await query;
  res.json(records);
});

router.post("/salary-adjustments", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { employeeId, month, year, type, amount, reason } = req.body;
  if (!employeeId || !month || !year || !type || amount === undefined) { res.status(400).json({ error: "employeeId, month, year, type, amount required" }); return; }
  if (!["bonus", "incentive", "penalty"].includes(type)) { res.status(400).json({ error: "type must be bonus, incentive, or penalty" }); return; }
  const amt = Number(amount);
  if (!isFinite(amt) || amt <= 0) { res.status(400).json({ error: "amount must be positive" }); return; }
  const [adjustment] = await db.insert(salaryAdjustmentsTable).values({
    employeeId, month, year, type, amount: amt, reason: reason || null, createdBy: (req as any).userId,
  }).returning();
  await createAuditLog("salary_adjustments", adjustment.id, "create", null, adjustment);
  res.json(adjustment);
});

router.delete("/salary-adjustments/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(salaryAdjustmentsTable).where(eq(salaryAdjustmentsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.appliedToSalaryId) { res.status(400).json({ error: "Cannot delete an adjustment already applied to a salary record" }); return; }
  await db.delete(salaryAdjustmentsTable).where(eq(salaryAdjustmentsTable.id, id));
  res.json({ success: true });
});

router.patch("/salary/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(salaryRecordsTable).where(eq(salaryRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const { paymentStatus, paymentProofUrl } = req.body;
  const updates: any = {};
  if (paymentStatus !== undefined) {
    if (!["pending", "paid"].includes(paymentStatus)) { res.status(400).json({ error: "paymentStatus must be 'pending' or 'paid'" }); return; }
    updates.paymentStatus = paymentStatus;
    if (paymentStatus === "paid") {
      updates.paidAt = new Date();
      updates.paidBy = (req as any).userId;
    } else {
      updates.paidAt = null;
      updates.paidBy = null;
      updates.paymentProofUrl = null;
    }
  }
  if (paymentProofUrl !== undefined) updates.paymentProofUrl = paymentProofUrl || null;

  const [updated] = await db.update(salaryRecordsTable).set(updates).where(eq(salaryRecordsTable.id, id)).returning();
  res.json(updated);
});

router.get("/uploads/salary-proofs/:filename", authMiddleware, async (req, res): Promise<void> => {
  const filePath = path.join(PROOF_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.sendFile(filePath);
});

router.post("/salary/:id/upload-proof", authMiddleware, adminOnly, proofUpload.single("file"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(salaryRecordsTable).where(eq(salaryRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const proofUrl = `/api/uploads/salary-proofs/${req.file.filename}`;
  const [updated] = await db.update(salaryRecordsTable).set({ paymentProofUrl: proofUrl }).where(eq(salaryRecordsTable.id, id)).returning();
  res.json(updated);
});

router.delete("/salary/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(salaryRecordsTable).where(eq(salaryRecordsTable.id, id));
    if (!existing) throw new Error("NOT_FOUND");
    await tx.update(salaryAdvancesTable)
      .set({ status: "pending", recoveredInSalaryId: null })
      .where(eq(salaryAdvancesTable.recoveredInSalaryId, id));
    await tx.update(salaryAdjustmentsTable)
      .set({ appliedToSalaryId: null })
      .where(eq(salaryAdjustmentsTable.appliedToSalaryId, id));
    await tx.delete(salaryRecordsTable).where(eq(salaryRecordsTable.id, id));
  }).then(() => res.json({ success: true }))
    .catch((err) => {
      if (err?.message === "NOT_FOUND") res.status(404).json({ error: "Not found" });
      else res.status(500).json({ error: err?.message || "Delete failed" });
    });
});

export default router;
