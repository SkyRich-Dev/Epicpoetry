import React, { useState, useEffect, useCallback } from 'react';
import { customFetch } from '@workspace/api-client-react/custom-fetch';
import { PageHeader, Button, Input, Label, Modal, formatCurrency } from '../components/ui-extras';
import { Plus, Pencil, Trash2, UserPlus, Clock, Users, CalendarDays, Briefcase, IndianRupee, CheckCircle2, Circle, Upload, ExternalLink, Settings2, Info } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';

const BASE = import.meta.env.BASE_URL || '/';

async function apiFetch(path: string, opts?: any) {
  const res = await customFetch(`${BASE}api/${path}`, opts);
  return res as any;
}

type Employee = {
  id: number; code: string; name: string; contactNumber?: string;
  position: string; salary?: number; employmentType?: string; active?: boolean;
};
type Shift = { id: number; name: string; startTime: string; endTime: string; active: boolean };
type SalaryRecord = {
  id: number; employeeId: number; employeeName: string; employeeCode: string;
  month: number; year: number; baseSalary: number; totalDaysInMonth: number;
  presentDays: number; halfDays: number; paidLeaves: number; unpaidLeaves: number;
  weekOffs: number; paidWeekOffs: number; excessWeekOffs: number;
  absentDays: number; absentPenaltyMultiplier: number;
  deductions: number; netSalary: number;
  paymentStatus: string; paymentProofUrl?: string | null; paidAt?: string | null; paidBy?: number | null;
};

const POSITIONS = ['Barista', 'Chef', 'Cashier', 'Waiter', 'Manager', 'Helper', 'Cleaner', 'Delivery Boy', 'Other'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function EmployeesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<'employees' | 'shifts' | 'salary'>('employees');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [salaryRecords, setSalaryRecords] = useState<SalaryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [empModal, setEmpModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [empForm, setEmpForm] = useState({ name: '', contactNumber: '', position: 'Barista', salary: '', employmentType: 'full-time' });

  const [shiftModal, setShiftModal] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [shiftForm, setShiftForm] = useState({ name: '', startTime: '09:00', endTime: '17:00' });

  const [salaryMonth, setSalaryMonth] = useState(new Date().getMonth() + 1);
  const [salaryYear, setSalaryYear] = useState(new Date().getFullYear());

  const [salarySettingsModal, setSalarySettingsModal] = useState(false);
  const [salarySettings, setSalarySettings] = useState({ allowedWeekOffsPerMonth: 4, absentPenaltyMultiplier: 1 });
  const [detailRecord, setDetailRecord] = useState<SalaryRecord | null>(null);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try { const data = await apiFetch('employees'); setEmployees(data); } catch { }
    setLoading(false);
  }, []);

  const loadShifts = useCallback(async () => {
    try { const data = await apiFetch('shifts'); setShifts(data); } catch { }
  }, []);

  const loadSalary = useCallback(async () => {
    try { const data = await apiFetch('salary'); setSalaryRecords(data); } catch { }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch('config');
      setSalarySettings({
        allowedWeekOffsPerMonth: data.allowedWeekOffsPerMonth ?? 4,
        absentPenaltyMultiplier: data.absentPenaltyMultiplier ?? 1,
      });
    } catch { }
  }, []);

  useEffect(() => {
    loadEmployees();
    loadShifts();
    if (isAdmin) { loadSalary(); loadConfig(); }
  }, [loadEmployees, loadShifts, loadSalary, loadConfig, isAdmin]);

  const saveEmployee = async () => {
    if (!empForm.name || !empForm.position) { toast({ title: 'Error', description: 'Name and position required', variant: 'destructive' }); return; }
    const body: any = { ...empForm, salary: Number(empForm.salary) || 0 };
    if (editingEmp) {
      body.active = editingEmp.active;
      await apiFetch(`employees/${editingEmp.id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
      toast({ title: 'Employee updated' });
    } else {
      await apiFetch('employees', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
      toast({ title: 'Employee added' });
    }
    setEmpModal(false); setEditingEmp(null);
    setEmpForm({ name: '', contactNumber: '', position: 'Barista', salary: '', employmentType: 'full-time' });
    loadEmployees();
  };

  const deleteEmployee = async (id: number) => {
    if (!confirm('Delete this employee?')) return;
    await apiFetch(`employees/${id}`, { method: 'DELETE' });
    toast({ title: 'Employee deleted' }); loadEmployees();
  };

  const openEditEmp = (emp: Employee) => {
    setEditingEmp(emp);
    setEmpForm({ name: emp.name, contactNumber: emp.contactNumber || '', position: emp.position, salary: String(emp.salary || 0), employmentType: emp.employmentType || 'full-time' });
    setEmpModal(true);
  };

  const saveShift = async () => {
    if (!shiftForm.name || !shiftForm.startTime || !shiftForm.endTime) { toast({ title: 'Error', description: 'All fields required', variant: 'destructive' }); return; }
    if (editingShift) {
      await apiFetch(`shifts/${editingShift.id}`, { method: 'PATCH', body: JSON.stringify(shiftForm), headers: { 'Content-Type': 'application/json' } });
      toast({ title: 'Shift updated' });
    } else {
      await apiFetch('shifts', { method: 'POST', body: JSON.stringify(shiftForm), headers: { 'Content-Type': 'application/json' } });
      toast({ title: 'Shift added' });
    }
    setShiftModal(false); setEditingShift(null);
    setShiftForm({ name: '', startTime: '09:00', endTime: '17:00' });
    loadShifts();
  };

  const deleteShift = async (id: number) => {
    if (!confirm('Delete this shift?')) return;
    await apiFetch(`shifts/${id}`, { method: 'DELETE' });
    toast({ title: 'Shift deleted' }); loadShifts();
  };

  const generateSalary = async () => {
    try {
      const result = await apiFetch('salary/generate', {
        method: 'POST',
        body: JSON.stringify({ month: salaryMonth, year: salaryYear }),
        headers: { 'Content-Type': 'application/json' },
      });
      toast({ title: `Salary generated for ${result.length} employee(s)` });
      loadSalary();
    } catch { toast({ title: 'Error generating salary', variant: 'destructive' }); }
  };

  const deleteSalaryRecord = async (id: number) => {
    if (!confirm('Delete this salary record?')) return;
    await apiFetch(`salary/${id}`, { method: 'DELETE' });
    toast({ title: 'Salary record deleted' }); loadSalary();
  };

  const togglePaymentStatus = async (record: SalaryRecord) => {
    const newStatus = record.paymentStatus === 'paid' ? 'pending' : 'paid';
    try {
      const token = localStorage.getItem('token');
      await fetch(`${BASE}api/salary/${record.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ paymentStatus: newStatus }),
      });
      toast({ title: newStatus === 'paid' ? 'Marked as paid' : 'Marked as pending' });
      loadSalary();
    } catch { toast({ title: 'Error updating status', variant: 'destructive' }); }
  };

  const uploadProof = async (recordId: number, file: File) => {
    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE}api/salary/${recordId}/upload-proof`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      toast({ title: 'Payment proof uploaded' });
      loadSalary();
    } catch { toast({ title: 'Error uploading proof', variant: 'destructive' }); }
  };

  const saveSalarySettings = async () => {
    try {
      await apiFetch('config', {
        method: 'PATCH',
        body: JSON.stringify(salarySettings),
        headers: { 'Content-Type': 'application/json' },
      });
      toast({ title: 'Salary settings saved' });
      setSalarySettingsModal(false);
    } catch { toast({ title: 'Error saving settings', variant: 'destructive' }); }
  };

  const filteredSalary = salaryRecords.filter(s => s.month === salaryMonth && s.year === salaryYear);

  const tabs = isAdmin
    ? [{ key: 'employees' as const, label: 'Employees', icon: Users }, { key: 'shifts' as const, label: 'Shifts', icon: Clock }, { key: 'salary' as const, label: 'Salary', icon: IndianRupee }]
    : [{ key: 'employees' as const, label: 'Employees', icon: Users }, { key: 'shifts' as const, label: 'Shifts', icon: Clock }];

  return (
    <div>
      <PageHeader title="Employee Management" description="Manage employees, shifts, and compensation" />

      <div className="flex gap-1 mb-6 bg-muted/60 rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'employees' && (
        <div>
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <Button onClick={() => { setEditingEmp(null); setEmpForm({ name: '', contactNumber: '', position: 'Barista', salary: '', employmentType: 'full-time' }); setEmpModal(true); }}>
                <UserPlus size={16} className="mr-2" /> Add Employee
              </Button>
            </div>
          )}
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b bg-transparent">
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Code</th>
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Name</th>
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Position</th>
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Type</th>
                {isAdmin && <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Contact</th>}
                {isAdmin && <th className="px-6 py-3.5 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Salary</th>}
                <th className="px-6 py-3.5 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Status</th>
                {isAdmin && <th className="px-6 py-3.5 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Actions</th>}
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">Loading...</td></tr>
                ) : employees.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">No employees yet</td></tr>
                ) : employees.map(emp => (
                  <tr key={emp.id} className="border-b border-border/50 hover:bg-muted/30 transition-all duration-150">
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{emp.code}</td>
                    <td className="px-6 py-4 font-medium">{emp.name}</td>
                    <td className="px-6 py-4">{emp.position}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-0.5 rounded-lg text-xs font-medium ${emp.employmentType === 'full-time' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                        {emp.employmentType === 'full-time' ? 'Full Time' : 'Part Time'}
                      </span>
                    </td>
                    {isAdmin && <td className="px-6 py-4">{emp.contactNumber || '-'}</td>}
                    {isAdmin && <td className="px-6 py-4 text-right font-numbers">{formatCurrency(emp.salary)}</td>}
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2.5 py-0.5 rounded-lg text-xs font-medium ${emp.active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {emp.active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => openEditEmp(emp)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"><Pencil size={15} /></button>
                          <button onClick={() => deleteEmployee(emp.id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Modal isOpen={empModal} onClose={() => setEmpModal(false)} title={editingEmp ? 'Edit Employee' : 'Add Employee'}>
            <div className="space-y-5">
              <div><Label>Name *</Label><Input value={empForm.name} onChange={e => setEmpForm({ ...empForm, name: e.target.value })} placeholder="Employee name" /></div>
              <div><Label>Contact Number</Label><Input value={empForm.contactNumber} onChange={e => setEmpForm({ ...empForm, contactNumber: e.target.value })} placeholder="Phone number" /></div>
              <div><Label>Position *</Label>
                <select className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm h-10 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring" value={empForm.position} onChange={e => setEmpForm({ ...empForm, position: e.target.value })}>
                  {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div><Label>Monthly Salary</Label><Input type="number" value={empForm.salary} onChange={e => setEmpForm({ ...empForm, salary: e.target.value })} placeholder="0" /></div>
              <div><Label>Employment Type</Label>
                <select className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm h-10 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring" value={empForm.employmentType} onChange={e => setEmpForm({ ...empForm, employmentType: e.target.value })}>
                  <option value="full-time">Full Time</option>
                  <option value="part-time">Part Time</option>
                </select>
              </div>
              {editingEmp && (
                <div><Label>Status</Label>
                  <select className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm h-10 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring" value={editingEmp.active !== false ? 'active' : 'inactive'} onChange={e => setEditingEmp({ ...editingEmp, active: e.target.value === 'active' })}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <Button onClick={saveEmployee} className="flex-1">{editingEmp ? 'Update' : 'Add'} Employee</Button>
                <Button variant="outline" onClick={() => setEmpModal(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {tab === 'shifts' && (
        <div>
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <Button onClick={() => { setEditingShift(null); setShiftForm({ name: '', startTime: '09:00', endTime: '17:00' }); setShiftModal(true); }}>
                <Clock size={16} className="mr-2" /> Add Shift
              </Button>
            </div>
          )}
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b bg-transparent">
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Shift Name</th>
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Start Time</th>
                <th className="px-6 py-3.5 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">End Time</th>
                <th className="px-6 py-3.5 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Status</th>
                {isAdmin && <th className="px-6 py-3.5 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Actions</th>}
              </tr></thead>
              <tbody>
                {shifts.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No shifts configured</td></tr>
                ) : shifts.map(s => (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-all duration-150">
                    <td className="px-6 py-4 font-medium">{s.name}</td>
                    <td className="px-6 py-4">{s.startTime}</td>
                    <td className="px-6 py-4">{s.endTime}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2.5 py-0.5 rounded-lg text-xs font-medium ${s.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {s.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => { setEditingShift(s); setShiftForm({ name: s.name, startTime: s.startTime, endTime: s.endTime }); setShiftModal(true); }} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"><Pencil size={15} /></button>
                          <button onClick={() => deleteShift(s.id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Modal isOpen={shiftModal} onClose={() => setShiftModal(false)} title={editingShift ? 'Edit Shift' : 'Add Shift'}>
            <div className="space-y-5">
              <div><Label>Shift Name *</Label><Input value={shiftForm.name} onChange={e => setShiftForm({ ...shiftForm, name: e.target.value })} placeholder="e.g. Morning Shift" /></div>
              <div><Label>Start Time *</Label><Input type="time" value={shiftForm.startTime} onChange={e => setShiftForm({ ...shiftForm, startTime: e.target.value })} /></div>
              <div><Label>End Time *</Label><Input type="time" value={shiftForm.endTime} onChange={e => setShiftForm({ ...shiftForm, endTime: e.target.value })} /></div>
              <div className="flex gap-3 pt-2">
                <Button onClick={saveShift} className="flex-1">{editingShift ? 'Update' : 'Add'} Shift</Button>
                <Button variant="outline" onClick={() => setShiftModal(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {tab === 'salary' && isAdmin && (
        <div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
            <div className="flex items-start gap-3">
              <Info size={18} className="text-blue-600 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">Salary Calculation Rules</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div><span className="font-medium">Present:</span> Full day salary</div>
                  <div><span className="font-medium">Half Day:</span> Half day salary</div>
                  <div><span className="font-medium">Week Off:</span> Full day salary (up to limit)</div>
                  <div><span className="font-medium">Absent:</span> No salary ({salarySettings.absentPenaltyMultiplier}x penalty)</div>
                </div>
                <p className="mt-1 text-xs">Allowed week-offs: <span className="font-semibold">{salarySettings.allowedWeekOffsPerMonth}/month</span>. Excess week-offs are deducted like absent days.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-end mb-4">
            <div>
              <Label>Month</Label>
              <select className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm h-10 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring" value={salaryMonth} onChange={e => setSalaryMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label>Year</Label>
              <Input type="number" value={salaryYear} onChange={e => setSalaryYear(Number(e.target.value))} className="w-24" />
            </div>
            <Button onClick={generateSalary}><IndianRupee size={16} className="mr-2" /> Generate Salary</Button>
            <Button variant="outline" onClick={() => setSalarySettingsModal(true)}><Settings2 size={16} className="mr-2" /> Salary Settings</Button>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b bg-transparent">
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Base Salary</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Days</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Present</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Half Days</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Paid Leave</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Unpaid</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Week Off</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Absent</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Deductions</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Net Salary</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Proof</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Actions</th>
              </tr></thead>
              <tbody>
                {filteredSalary.length === 0 ? (
                  <tr><td colSpan={14} className="px-6 py-12 text-center text-muted-foreground">No salary records for {MONTHS[salaryMonth - 1]} {salaryYear}. Click "Generate Salary" to compute.</td></tr>
                ) : filteredSalary.map(s => (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-all duration-150 cursor-pointer" onClick={() => setDetailRecord(s)}>
                    <td className="px-4 py-3"><div className="font-medium">{s.employeeName}</div><div className="text-xs text-muted-foreground">{s.employeeCode}</div></td>
                    <td className="px-4 py-3 text-right font-numbers">{formatCurrency(s.baseSalary)}</td>
                    <td className="px-4 py-3 text-right">{s.totalDaysInMonth}</td>
                    <td className="px-4 py-3 text-right">{s.presentDays}</td>
                    <td className="px-4 py-3 text-right">{s.halfDays}</td>
                    <td className="px-4 py-3 text-right">{s.paidLeaves}</td>
                    <td className="px-4 py-3 text-right">{s.unpaidLeaves}</td>
                    <td className="px-4 py-3 text-right">
                      <span>{s.paidWeekOffs || s.weekOffs}</span>
                      {(s.excessWeekOffs || 0) > 0 && (
                        <span className="text-red-500 text-xs ml-1">(+{s.excessWeekOffs} excess)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{s.absentDays}</td>
                    <td className="px-4 py-3 text-right font-numbers text-red-600">{formatCurrency(s.deductions)}</td>
                    <td className="px-4 py-3 text-right font-numbers font-semibold text-emerald-700">{formatCurrency(s.netSalary)}</td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => togglePaymentStatus(s)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                          s.paymentStatus === 'paid'
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                        }`}
                        title={s.paymentStatus === 'paid' ? 'Click to mark as pending' : 'Click to mark as paid'}
                      >
                        {s.paymentStatus === 'paid' ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                        {s.paymentStatus === 'paid' ? 'Paid' : 'Pending'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      {s.paymentProofUrl ? (
                        <button
                          onClick={async () => {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`${BASE}api/salary/${s.id}/proof`, { headers: { 'Authorization': `Bearer ${token}` } });
                            if (res.ok) {
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              window.open(url, '_blank');
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <ExternalLink size={12} /> View
                        </button>
                      ) : (
                        <label className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted transition-colors cursor-pointer">
                          <Upload size={12} /> Upload
                          <input type="file" className="hidden" accept="image/*,.pdf" onChange={e => { if (e.target.files?.[0]) uploadProof(s.id, e.target.files[0]); }} />
                        </label>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <button onClick={() => deleteSalaryRecord(s.id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Modal isOpen={salarySettingsModal} onClose={() => setSalarySettingsModal(false)} title="Salary Calculation Settings">
            <div className="space-y-5">
              <div>
                <Label>Allowed Week-Offs Per Month</Label>
                <Input type="number" min="0" max="15" value={salarySettings.allowedWeekOffsPerMonth} onChange={e => setSalarySettings({ ...salarySettings, allowedWeekOffsPerMonth: Number(e.target.value) })} />
                <p className="text-xs text-muted-foreground mt-1">Week-offs within this limit get full day salary. Excess week-offs are deducted like absent days.</p>
              </div>
              <div>
                <Label>Absent Penalty Multiplier</Label>
                <Input type="number" min="0" max="3" step="0.1" value={salarySettings.absentPenaltyMultiplier} onChange={e => setSalarySettings({ ...salarySettings, absentPenaltyMultiplier: Number(e.target.value) })} />
                <p className="text-xs text-muted-foreground mt-1">1x = deduct 1 day salary per absent. 1.5x = deduct 1.5 days salary per absent. 2x = double penalty.</p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button onClick={saveSalarySettings} className="flex-1">Save Settings</Button>
                <Button variant="outline" onClick={() => setSalarySettingsModal(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          </Modal>

          <Modal isOpen={!!detailRecord} onClose={() => setDetailRecord(null)} title={detailRecord ? `Salary Breakdown: ${detailRecord.employeeName}` : ''} maxWidth="max-w-lg">
            {detailRecord && (() => {
              const perDay = detailRecord.baseSalary / detailRecord.totalDaysInMonth;
              const paidWO = detailRecord.paidWeekOffs || detailRecord.weekOffs;
              const excessWO = detailRecord.excessWeekOffs || 0;
              const mult = detailRecord.absentPenaltyMultiplier || 1;
              return (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Base Salary</div>
                      <div className="text-lg font-semibold font-numbers">{formatCurrency(detailRecord.baseSalary)}</div>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Per Day Rate</div>
                      <div className="text-lg font-semibold font-numbers">{formatCurrency(perDay)}</div>
                    </div>
                  </div>

                  <div className="border rounded-lg divide-y">
                    <div className="px-4 py-2.5 flex justify-between text-sm">
                      <span>Present Days ({detailRecord.presentDays} days x full rate)</span>
                      <span className="font-numbers text-emerald-700">+{formatCurrency(detailRecord.presentDays * perDay)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between text-sm">
                      <span>Half Days ({detailRecord.halfDays} days x half rate)</span>
                      <span className="font-numbers text-amber-600">-{formatCurrency(detailRecord.halfDays * 0.5 * perDay)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between text-sm">
                      <span>Paid Week-Offs ({paidWO} days x full rate)</span>
                      <span className="font-numbers text-emerald-700">+{formatCurrency(paidWO * perDay)}</span>
                    </div>
                    {excessWO > 0 && (
                      <div className="px-4 py-2.5 flex justify-between text-sm bg-red-50">
                        <span className="text-red-700">Excess Week-Offs ({excessWO} days x 1 day rate)</span>
                        <span className="font-numbers text-red-600">-{formatCurrency(excessWO * perDay)}</span>
                      </div>
                    )}
                    <div className="px-4 py-2.5 flex justify-between text-sm">
                      <span>Paid Leaves ({detailRecord.paidLeaves} days)</span>
                      <span className="font-numbers text-emerald-700">No deduction</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between text-sm">
                      <span>Unpaid Leaves ({detailRecord.unpaidLeaves} days x 1 day rate)</span>
                      <span className="font-numbers text-red-600">-{formatCurrency(detailRecord.unpaidLeaves * perDay)}</span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-between text-sm">
                      <span>Absent ({detailRecord.absentDays} days x {mult}x penalty)</span>
                      <span className="font-numbers text-red-600">-{formatCurrency(detailRecord.absentDays * mult * perDay)}</span>
                    </div>
                  </div>

                  <div className="border-t-2 border-foreground/20 pt-3 flex justify-between items-center">
                    <div>
                      <div className="text-sm text-muted-foreground">Total Deductions</div>
                      <div className="font-semibold font-numbers text-red-600">{formatCurrency(detailRecord.deductions)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Net Salary</div>
                      <div className="text-xl font-bold font-numbers text-emerald-700">{formatCurrency(detailRecord.netSalary)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </Modal>
        </div>
      )}
    </div>
  );
}
