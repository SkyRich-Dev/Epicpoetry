import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from '../lib/api';
import { PageHeader, Button, Input, Label, Badge, cn } from '../components/ui-extras';
import { useAuth } from '../lib/auth';
import { Clock, LogIn, LogOut, AlertCircle, CheckCircle, RefreshCw, Users } from 'lucide-react';
import { useToast } from '../hooks/use-toast';

function getToday() { return new Date().toISOString().split('T')[0]; }
function fmtTime(ts: string | null) { if (!ts) return '—'; return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDuration(clockIn: string, clockOut?: string) {
  const end = clockOut ? new Date(clockOut) : new Date();
  const mins = Math.floor((end.getTime() - new Date(clockIn).getTime()) / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

interface Employee { id: number; name: string; code: string; department?: string; }
interface TimeClockRecord {
  id: number; employeeId: number; employeeName: string; employeeCode: string;
  shiftId?: number; clockDate: string; clockIn?: string; clockOut?: string;
  lateFlag: boolean; earlyDepartureFlag: boolean; overtimeMinutes: number;
  overtimeApproved: boolean; notes?: string;
}

export default function TimeClockPage() {
  const { hasPerm, user } = useAuth();
  const { toast } = useToast();
  const [date, setDate] = useState(getToday());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<TimeClockRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [searchEmp, setSearchEmp] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, recs] = await Promise.all([
        apiFetch('/employees?status=active').then((r: Response) => r.json()),
        apiFetch(`/timeclock?date=${date}`).then((r: Response) => r.json()),
      ]);
      setEmployees(Array.isArray(emps) ? emps : emps?.data || []);
      setRecords(Array.isArray(recs) ? recs : []);
    } catch { toast({ title: 'Failed to load time clock', variant: 'destructive' }); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const clockIn = async (employeeId: number) => {
    setSaving(employeeId);
    try {
      const r = await apiFetch('/timeclock/clock-in', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      toast({ title: 'Clocked in ✓' }); load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(null);
  };

  const clockOut = async (employeeId: number) => {
    setSaving(employeeId);
    try {
      const r = await apiFetch('/timeclock/clock-out', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      toast({ title: 'Clocked out ✓' }); load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(null);
  };

  const approveOvertime = async (recordId: number) => {
    try {
      await apiFetch(`/timeclock/${recordId}/approve-overtime`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      toast({ title: 'Overtime approved' }); load();
    } catch { toast({ title: 'Failed to approve overtime', variant: 'destructive' }); }
  };

  const recordMap = new Map(records.map(r => [r.employeeId, r]));
  const presentCount = records.filter(r => r.clockIn).length;
  const clockedOutCount = records.filter(r => r.clockIn && r.clockOut).length;
  const pendingOT = records.filter(r => r.overtimeMinutes > 0 && !r.overtimeApproved).length;

  const filteredEmployees = employees.filter(e =>
    !searchEmp || e.name.toLowerCase().includes(searchEmp.toLowerCase()) ||
    e.code.toLowerCase().includes(searchEmp.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Time Clock" description="Staff clock-in/out and shift tracking">
        <div className="flex items-center gap-3">
          <input type="date" max={getToday()} value={date} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDate(e.target.value)}
            className="rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </PageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-card border p-4">
          <div className="flex items-center gap-2 mb-1 text-muted-foreground"><Users className="w-4 h-4" /><span className="text-sm">Total Staff</span></div>
          <div className="text-3xl font-bold">{employees.length}</div>
        </div>
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
          <div className="flex items-center gap-2 mb-1 text-emerald-600"><LogIn className="w-4 h-4" /><span className="text-sm">Clocked In</span></div>
          <div className="text-3xl font-bold text-emerald-700">{presentCount}</div>
        </div>
        <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4">
          <div className="flex items-center gap-2 mb-1 text-blue-600"><LogOut className="w-4 h-4" /><span className="text-sm">Clocked Out</span></div>
          <div className="text-3xl font-bold text-blue-700">{clockedOutCount}</div>
        </div>
        <div className={cn('rounded-2xl border p-4', pendingOT > 0 ? 'bg-amber-50 border-amber-200' : 'bg-card')}>
          <div className="flex items-center gap-2 mb-1 text-muted-foreground"><AlertCircle className="w-4 h-4" /><span className="text-sm">Pending OT Approval</span></div>
          <div className={cn('text-3xl font-bold', pendingOT > 0 ? 'text-amber-700' : '')}>{pendingOT}</div>
        </div>
      </div>

      {/* Clock-in board */}
      <div className="rounded-2xl bg-card border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Quick Clock-In / Out — {date}</h3>
          <Input placeholder="Search staff…" value={searchEmp} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setSearchEmp(e.target.value)} className="w-48 h-8 text-sm" />
        </div>
        {loading ? <div className="text-center py-8 text-muted-foreground">Loading…</div> :
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredEmployees.map(emp => {
              const rec = recordMap.get(emp.id);
              const isClockedIn = rec?.clockIn && !rec?.clockOut;
              const isDone = rec?.clockIn && rec?.clockOut;
              return (
                <div key={emp.id} className={cn('rounded-2xl border-2 p-3 text-center transition-all',
                  isClockedIn ? 'bg-emerald-50 border-emerald-300' :
                  isDone ? 'bg-blue-50 border-blue-200' : 'bg-card border-border')}>
                  <p className="font-semibold text-sm truncate">{emp.name}</p>
                  <p className="text-xs text-muted-foreground mb-2">{emp.code}</p>
                  {rec?.clockIn && (
                    <p className="text-xs mb-1">
                      <Clock className="w-3 h-3 inline mr-0.5" />
                      {fmtTime(rec.clockIn || null)}{rec.clockOut ? ` → ${fmtTime(rec.clockOut)}` : ''}
                    </p>
                  )}
                  {isClockedIn && rec?.clockIn && (
                    <p className="text-xs text-emerald-600 mb-1.5">{fmtDuration(rec.clockIn)}</p>
                  )}
                  {rec?.lateFlag && <p className="text-xs text-amber-600 mb-1">⚠ Late</p>}
                  {(rec?.overtimeMinutes ?? 0) > 0 && (
                    <p className={cn('text-xs mb-1', rec?.overtimeApproved ? 'text-blue-600' : 'text-red-600')}>
                      OT: {rec?.overtimeMinutes}m{rec?.overtimeApproved ? ' ✓' : ''}
                    </p>
                  )}
                  {date === getToday() && (
                    <>
                      {!rec?.clockIn && (
                        <button onClick={() => clockIn(emp.id)} disabled={saving === emp.id}
                          className="w-full text-xs py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 mt-1">
                          {saving === emp.id ? '…' : 'Clock In'}
                        </button>
                      )}
                      {isClockedIn && (
                        <button onClick={() => clockOut(emp.id)} disabled={saving === emp.id}
                          className="w-full text-xs py-1.5 rounded-xl bg-red-600 text-white hover:bg-red-700 mt-1">
                          {saving === emp.id ? '…' : 'Clock Out'}
                        </button>
                      )}
                      {isDone && <p className="text-xs text-blue-600 font-medium mt-1">✓ Complete</p>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        }
      </div>

      {/* Detailed records table */}
      {records.length > 0 && (
        <div className="rounded-2xl bg-card border overflow-hidden">
          <div className="p-4 border-b"><h3 className="font-semibold">Time Records — {date}</h3></div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>{['Employee','Clock In','Clock Out','Duration','Late','Overtime','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.employeeName}</p>
                    <p className="text-xs text-muted-foreground">{r.employeeCode}</p>
                  </td>
                  <td className="px-4 py-3">{fmtTime(r.clockIn || null)}</td>
                  <td className="px-4 py-3">{fmtTime(r.clockOut || null)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.clockIn ? fmtDuration(r.clockIn, r.clockOut || undefined) : '—'}</td>
                  <td className="px-4 py-3">
                    {r.lateFlag ? <span className="text-xs text-amber-600 font-medium">⚠ Late</span> : <span className="text-xs text-emerald-600">On time</span>}
                  </td>
                  <td className="px-4 py-3">
                    {r.overtimeMinutes > 0 ? (
                      <span className={cn('text-xs font-medium', r.overtimeApproved ? 'text-blue-600' : 'text-red-600')}>
                        {r.overtimeMinutes}m {r.overtimeApproved ? '(Approved)' : '(Pending)'}
                      </span>
                    ) : <span className="text-xs text-muted-foreground">None</span>}
                  </td>
                  <td className="px-4 py-3">
                    {r.overtimeMinutes > 0 && !r.overtimeApproved && hasPerm('employees.edit') && (
                      <Button size="sm" variant="outline" onClick={() => approveOvertime(r.id)}>Approve OT</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
