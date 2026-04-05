import React, { useState, useEffect, useCallback } from 'react';
import { customFetch } from '@workspace/api-client-react/custom-fetch';
import { PageHeader, Button, Input, Label, Modal } from '../components/ui-extras';
import { CalendarDays, Clock, Plus, Check, Trash2, UserCheck, AlertCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';

const BASE = import.meta.env.BASE_URL || '/';
async function apiFetch(path: string, opts?: any) {
  const res = await customFetch(`${BASE}api/${path}`, opts);
  return res as any;
}

type Employee = { id: number; code: string; name: string; position: string; employmentType?: string; active?: boolean };
type Shift = { id: number; name: string; startTime: string; endTime: string; active: boolean };
type AttendanceRecord = { id: number; employeeId: number; employeeName: string; employeeCode: string; attendanceDate: string; shiftId: number | null; shiftName: string | null; status: string };
type LeaveRecord = { id: number; employeeId: number; employeeName: string; employeeCode: string; leaveDate: string; leaveType: string; reason: string | null };

const STATUS_COLORS: Record<string, string> = {
  'present': 'bg-emerald-100 text-emerald-700',
  'half-day': 'bg-amber-100 text-amber-700',
  'absent': 'bg-red-100 text-red-700',
  'week-off': 'bg-blue-100 text-blue-700',
};

export default function AttendancePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const [tab, setTab] = useState<'attendance' | 'leaves' | 'monthly'>('attendance');

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [entries, setEntries] = useState<Record<number, { status: string; shiftId: number | null }>>({});

  const [leaveModal, setLeaveModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ employeeId: '', leaveDate: new Date().toISOString().split('T')[0], leaveType: 'paid', reason: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, shf, att, lvs] = await Promise.all([
        apiFetch('employees'),
        apiFetch('shifts'),
        apiFetch(`attendance?date=${date}`),
        apiFetch('leaves'),
      ]);
      setEmployees(emps.filter((e: Employee) => e.active !== false));
      setShifts(shf.filter((s: Shift) => s.active));
      setAttendance(att);
      setLeaves(lvs);

      const map: Record<number, { status: string; shiftId: number | null }> = {};
      for (const emp of emps.filter((e: Employee) => e.active !== false)) {
        const rec = att.find((a: AttendanceRecord) => a.employeeId === emp.id);
        map[emp.id] = rec
          ? { status: rec.status, shiftId: rec.shiftId }
          : { status: '', shiftId: shf.length > 0 ? shf[0].id : null };
      }
      setEntries(map);
    } catch { }
    setLoading(false);
  }, [date]);

  useEffect(() => { loadData(); }, [loadData]);

  const updateEntry = (empId: number, field: string, value: any) => {
    setEntries(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: value } }));
  };

  const saveAttendance = async () => {
    const toSave = Object.entries(entries)
      .filter(([_, v]) => v.status !== '')
      .map(([empId, v]) => ({ employeeId: Number(empId), shiftId: v.shiftId, status: v.status }));

    if (toSave.length === 0) { toast({ title: 'No attendance marked', variant: 'destructive' }); return; }

    try {
      await apiFetch('attendance/bulk', {
        method: 'POST',
        body: JSON.stringify({ date, entries: toSave }),
        headers: { 'Content-Type': 'application/json' },
      });
      toast({ title: `Attendance saved for ${toSave.length} employee(s)` });
      loadData();
    } catch { toast({ title: 'Error saving attendance', variant: 'destructive' }); }
  };

  const saveLeave = async () => {
    if (!leaveForm.employeeId || !leaveForm.leaveDate || !leaveForm.leaveType) {
      toast({ title: 'Error', description: 'All fields required', variant: 'destructive' }); return;
    }
    try {
      await apiFetch('leaves', {
        method: 'POST',
        body: JSON.stringify({ ...leaveForm, employeeId: Number(leaveForm.employeeId) }),
        headers: { 'Content-Type': 'application/json' },
      });
      toast({ title: 'Leave recorded' });
      setLeaveModal(false);
      setLeaveForm({ employeeId: '', leaveDate: new Date().toISOString().split('T')[0], leaveType: 'paid', reason: '' });
      loadData();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Could not save leave', variant: 'destructive' });
    }
  };

  const deleteLeave = async (id: number) => {
    if (!confirm('Delete this leave record?')) return;
    await apiFetch(`leaves/${id}`, { method: 'DELETE' });
    toast({ title: 'Leave deleted' }); loadData();
  };

  const markedCount = attendance.length;
  const presentCount = attendance.filter(a => a.status === 'present').length;
  const halfDayCount = attendance.filter(a => a.status === 'half-day').length;
  const absentCount = attendance.filter(a => a.status === 'absent').length;
  const weekOffCount = attendance.filter(a => a.status === 'week-off').length;

  return (
    <div>
      <PageHeader title="Attendance & Leave" description="Mark daily attendance and manage employee leaves" />

      <div className="flex gap-1 mb-6 bg-muted/60 rounded-xl p-1 w-fit">
        {[{ key: 'attendance' as const, label: 'Attendance', icon: UserCheck }, { key: 'leaves' as const, label: 'Leave Management', icon: CalendarDays }, { key: 'monthly' as const, label: 'Monthly Summary', icon: CalendarDays }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'attendance' && (
        <div>
          <div className="flex flex-wrap gap-3 items-end mb-4">
            <div>
              <Label>Date</Label>
              <Input type="date" max={new Date().toISOString().split('T')[0]} value={date} onChange={e => setDate(e.target.value)} className="w-44" />
            </div>
            {!isViewer && <Button onClick={saveAttendance}><Check size={16} className="mr-2" /> Save Attendance</Button>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
            <div className="bg-card rounded-lg border p-3 text-center"><div className="text-2xl font-bold font-numbers">{employees.length}</div><div className="text-xs text-muted-foreground">Total</div></div>
            <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3 text-center"><div className="text-2xl font-bold text-emerald-700 font-numbers">{presentCount}</div><div className="text-xs text-emerald-600">Present</div></div>
            <div className="bg-amber-50 rounded-lg border border-amber-200 p-3 text-center"><div className="text-2xl font-bold text-amber-700 font-numbers">{halfDayCount}</div><div className="text-xs text-amber-600">Half Day</div></div>
            <div className="bg-red-50 rounded-lg border border-red-200 p-3 text-center"><div className="text-2xl font-bold text-red-700 font-numbers">{absentCount}</div><div className="text-xs text-red-600">Absent</div></div>
            <div className="bg-blue-50 rounded-lg border border-blue-200 p-3 text-center"><div className="text-2xl font-bold text-blue-700 font-numbers">{weekOffCount}</div><div className="text-xs text-blue-600">Week Off</div></div>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b bg-transparent">
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Employee</th>
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Shift</th>
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Status</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={3} className="px-6 py-12 text-center text-muted-foreground">Loading...</td></tr>
                ) : employees.length === 0 ? (
                  <tr><td colSpan={3} className="px-6 py-12 text-center text-muted-foreground">No active employees</td></tr>
                ) : employees.map(emp => {
                  const entry = entries[emp.id] || { status: '', shiftId: null };
                  return (
                    <tr key={emp.id} className="border-b border-border/50 hover:bg-muted/30 transition-all duration-150">
                      <td className="px-6 py-3">
                        <div className="font-medium">{emp.name}</div>
                        <div className="text-xs text-muted-foreground">{emp.position}</div>
                      </td>
                      <td className="px-6 py-3">
                        <select className="rounded-xl border border-input bg-background px-3 py-1.5 text-sm" value={entry.shiftId || ''} onChange={e => updateEntry(emp.id, 'shiftId', e.target.value ? Number(e.target.value) : null)}>
                          <option value="">No Shift</option>
                          {shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.startTime}-{s.endTime})</option>)}
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex gap-1.5 flex-wrap">
                          {['present', 'half-day', 'absent', 'week-off'].map(st => (
                            <button key={st} onClick={() => updateEntry(emp.id, 'status', entry.status === st ? '' : st)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${entry.status === st ? STATUS_COLORS[st] + ' border-current ring-1 ring-current/20' : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'}`}>
                              {st === 'present' ? 'P' : st === 'half-day' ? '½' : st === 'absent' ? 'A' : 'WO'}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'leaves' && (
        <div>
          <div className="flex justify-end mb-4">
            {!isViewer && <Button onClick={() => setLeaveModal(true)}><Plus size={16} className="mr-2" /> Record Leave</Button>}
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b bg-transparent">
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Employee</th>
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Date</th>
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Type</th>
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Reason</th>
                <th className="px-6 py-3.5 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Actions</th>
              </tr></thead>
              <tbody>
                {leaves.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No leave records</td></tr>
                ) : leaves.map(l => (
                  <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30 transition-all duration-150">
                    <td className="px-6 py-4"><div className="font-medium">{l.employeeName}</div></td>
                    <td className="px-6 py-4">{l.leaveDate}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-0.5 rounded-lg text-xs font-medium ${l.leaveType === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {l.leaveType === 'paid' ? 'Paid Leave' : 'Unpaid Leave'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{l.reason || '-'}</td>
                    <td className="px-6 py-4 text-center">
                      {isAdmin && <button onClick={() => deleteLeave(l.id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Modal isOpen={leaveModal} onClose={() => setLeaveModal(false)} title="Record Leave" footer={<><Button variant="ghost" onClick={() => setLeaveModal(false)}>Cancel</Button><Button onClick={saveLeave}>Save Leave</Button></>}>
            <div className="space-y-5">
              <div><Label>Employee *</Label>
                <select className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm h-10 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring" value={leaveForm.employeeId} onChange={e => setLeaveForm({ ...leaveForm, employeeId: e.target.value })}>
                  <option value="">Select Employee</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div><Label>Leave Date *</Label><Input type="date" max={new Date().toISOString().split('T')[0]} value={leaveForm.leaveDate} onChange={e => setLeaveForm({ ...leaveForm, leaveDate: e.target.value })} /></div>
              <div><Label>Leave Type *</Label>
                <select className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm h-10 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring" value={leaveForm.leaveType} onChange={e => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}>
                  <option value="paid">Paid Leave</option>
                  <option value="unpaid">Unpaid Leave</option>
                </select>
              </div>
              <div><Label>Reason</Label><Input value={leaveForm.reason} onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder="Optional reason" /></div>
            </div>
          </Modal>
        </div>
      )}

      {tab === 'monthly' && <MonthlySummaryTab employees={employees} />}
    </div>
  );
}

function MonthlySummaryTab({ employees }: { employees: Employee[] }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [monthData, setMonthData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMonthData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [year, mon] = month.split('-').map(Number);
      const daysInMonth = new Date(year, mon, 0).getDate();
      const allDays: string[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        allDays.push(`${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }

      const results = await Promise.all(
        allDays.map(date => apiFetch(`attendance?date=${date}`).catch(() => []))
      );

      const empMap: Record<number, { present: number; halfDay: number; absent: number; weekOff: number; total: number }> = {};
      employees.forEach(emp => {
        empMap[emp.id] = { present: 0, halfDay: 0, absent: 0, weekOff: 0, total: daysInMonth };
      });

      results.forEach((dayRecords: AttendanceRecord[]) => {
        dayRecords.forEach((rec: AttendanceRecord) => {
          if (!empMap[rec.employeeId]) return;
          if (rec.status === 'present') empMap[rec.employeeId].present++;
          else if (rec.status === 'half-day') empMap[rec.employeeId].halfDay++;
          else if (rec.status === 'absent') empMap[rec.employeeId].absent++;
          else if (rec.status === 'week-off') empMap[rec.employeeId].weekOff++;
        });
      });

      const data = employees.map(emp => ({
        ...emp,
        ...empMap[emp.id],
      }));
      setMonthData(data);
    } catch { }
    setLoading(false);
  }, [month, employees]);

  React.useEffect(() => { loadMonthData(); }, [loadMonthData]);

  const prevMonth = () => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const nextMonth = () => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const monthLabel = (() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  })();

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={prevMonth} className="px-3 py-1.5 rounded-lg border text-sm hover:bg-muted">&larr;</button>
        <span className="text-lg font-semibold">{monthLabel}</span>
        <button onClick={nextMonth} className="px-3 py-1.5 rounded-lg border text-sm hover:bg-muted">&rarr;</button>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b bg-transparent">
            <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Employee</th>
            <th className="px-4 py-3.5 text-center text-xs font-semibold text-emerald-600 uppercase">Present</th>
            <th className="px-4 py-3.5 text-center text-xs font-semibold text-amber-600 uppercase">Half Day</th>
            <th className="px-4 py-3.5 text-center text-xs font-semibold text-red-600 uppercase">Absent</th>
            <th className="px-4 py-3.5 text-center text-xs font-semibold text-blue-600 uppercase">Week Off</th>
            <th className="px-4 py-3.5 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Attendance %</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">Loading monthly data...</td></tr>
            ) : monthData.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No employees found.</td></tr>
            ) : monthData.map(emp => {
              const workDays = emp.total - emp.weekOff;
              const pct = workDays > 0 ? ((emp.present + emp.halfDay * 0.5) / workDays * 100) : 0;
              return (
                <tr key={emp.id} className="border-b border-border/50 hover:bg-muted/30 transition-all duration-150">
                  <td className="px-6 py-3">
                    <div className="font-medium">{emp.name}</div>
                    <div className="text-xs text-muted-foreground">{emp.position}</div>
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-emerald-700">{emp.present}</td>
                  <td className="px-4 py-3 text-center font-bold text-amber-700">{emp.halfDay}</td>
                  <td className="px-4 py-3 text-center font-bold text-red-700">{emp.absent}</td>
                  <td className="px-4 py-3 text-center font-bold text-blue-700">{emp.weekOff}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2.5 py-0.5 rounded-lg text-xs font-medium ${pct >= 90 ? 'bg-emerald-100 text-emerald-700' : pct >= 75 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      {pct.toFixed(0)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
