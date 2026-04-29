import React, { useState, useEffect } from 'react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, formatDate, Badge } from '../components/ui-extras';
import { Plus, Search, Cake, Heart, Edit2, Trash2, Eye, Phone, RefreshCw } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';

const BASE = import.meta.env.BASE_URL || '/';
async function apiFetch(path: string, opts?: any) {
  const token = localStorage.getItem('token');
  const headers: any = { 'Authorization': `Bearer ${token}` };
  if (opts?.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}api/${path}`, { ...opts, headers: { ...headers, ...opts?.headers } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const SEGMENTS = [
  { key: '', label: 'All' },
  { key: 'high_value', label: 'High Value' },
  { key: 'frequent', label: 'Frequent' },
  { key: 'regular', label: 'Regular' },
  { key: 'new', label: 'New' },
  { key: 'inactive', label: 'Inactive' },
];

const SEG_COLOR: Record<string, string> = {
  high_value: 'bg-purple-100 text-purple-700',
  frequent: 'bg-blue-100 text-blue-700',
  regular: 'bg-emerald-100 text-emerald-700',
  new: 'bg-amber-100 text-amber-700',
  inactive: 'bg-gray-200 text-gray-600',
};

export default function CustomersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { toast } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [reminders, setReminders] = useState<{ birthdays: any[]; anniversaries: any[] }>({ birthdays: [], anniversaries: [] });
  const [form, setForm] = useState({ name: '', phone: '', email: '', birthday: '', anniversary: '', notes: '' });
  const [dupConfirm, setDupConfirm] = useState<{ message: string; kind: 'exact' | 'similar'; canConfirm: boolean; matches: any[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (segment) params.set('segment', segment);
      const data = await apiFetch(`customers?${params.toString()}`);
      setList(data);
      const r = await apiFetch('customers/reminders/upcoming?days=14');
      setReminders(r);
    } catch (e: any) { toast({ title: 'Failed to load', description: e.message, variant: 'destructive' }); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [segment]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', phone: '', email: '', birthday: '', anniversary: '', notes: '' });
    setModal(true);
  };
  const openEdit = (c: any) => {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone, email: c.email || '', birthday: c.birthday || '', anniversary: c.anniversary || '', notes: c.notes || '' });
    setModal(true);
  };

  const submitSave = async (extraFlags: { confirmDuplicate?: boolean; confirmSimilar?: boolean } = {}) => {
    const token = localStorage.getItem('token');
    const url = editing ? `${BASE}api/customers/${editing.id}` : `${BASE}api/customers`;
    const method = editing ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ...form, ...extraFlags }) });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      if (body && body.duplicateKind) return { needsConfirm: true, body };
      throw new Error(body?.error || 'Conflict');
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = text;
      try { const j = JSON.parse(text); msg = j.error || text; } catch { /* keep raw */ }
      throw new Error(msg);
    }
    return { needsConfirm: false };
  };

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim()) { toast({ title: 'Name and phone required', variant: 'destructive' }); return; }
    try {
      const r = await submitSave();
      if (r.needsConfirm) {
        const b = (r as any).body;
        if (!b.canConfirm) {
          toast({ title: 'Duplicate customer', description: b.error, variant: 'destructive' });
          return;
        }
        setDupConfirm({ message: b.error, kind: b.duplicateKind, canConfirm: !!b.canConfirm, matches: b.duplicates || [] });
        return;
      }
      setModal(false);
      toast({ title: editing ? 'Customer updated' : 'Customer created' });
      load();
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleConfirmDuplicate = async () => {
    if (!dupConfirm) return;
    try {
      const flags = dupConfirm.kind === 'exact' ? { confirmDuplicate: true } : { confirmSimilar: true };
      await submitSave(flags);
      setDupConfirm(null);
      setModal(false);
      toast({ title: editing ? 'Customer updated' : 'Customer created' });
      load();
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  const del = async (c: any) => {
    if (!confirm(`Delete customer "${c.name}"? This will only remove the profile (invoices kept).`)) return;
    try { await apiFetch(`customers/${c.id}`, { method: 'DELETE' }); toast({ title: 'Deleted' }); load(); }
    catch (e: any) { toast({ title: 'Failed', description: e.message, variant: 'destructive' }); }
  };

  const openDetail = async (c: any) => {
    try { const data = await apiFetch(`customers/${c.id}`); setDetail(data); }
    catch (e: any) { toast({ title: 'Failed', description: e.message, variant: 'destructive' }); }
  };

  const recompute = async () => {
    if (!isAdmin) return;
    try {
      const r = await apiFetch('customers/recompute-all', { method: 'POST' });
      toast({ title: 'Recompute done', description: `Created ${r.created}, linked ${r.linked} of ${r.customers} customers` });
      load();
    } catch (e: any) { toast({ title: 'Failed', description: e.message, variant: 'destructive' }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="Customer master, profiles & reminders">
        {isAdmin && (
          <Button variant="ghost" onClick={recompute} title="Re-link all invoices to customers and recompute totals">
            <RefreshCw className="w-4 h-4 mr-2" /> Recompute
          </Button>
        )}
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Add Customer</Button>
      </PageHeader>

      {(reminders.birthdays.length > 0 || reminders.anniversaries.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reminders.birthdays.length > 0 && (
            <div className="rounded-2xl border bg-pink-50 p-4">
              <div className="flex items-center gap-2 mb-3 text-pink-800 font-semibold"><Cake className="w-4 h-4" /> Upcoming Birthdays (next 14 days)</div>
              <div className="space-y-2">
                {reminders.birthdays.slice(0, 6).map(b => (
                  <div key={b.id} className="flex items-center justify-between text-sm">
                    <div><span className="font-medium">{b.name}</span> <span className="text-muted-foreground">· {b.phone}</span></div>
                    <div className="text-xs px-2 py-1 rounded-full bg-pink-200 text-pink-800">{b.daysUntil === 0 ? 'Today' : `in ${b.daysUntil}d`}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {reminders.anniversaries.length > 0 && (
            <div className="rounded-2xl border bg-rose-50 p-4">
              <div className="flex items-center gap-2 mb-3 text-rose-800 font-semibold"><Heart className="w-4 h-4" /> Upcoming Anniversaries (next 14 days)</div>
              <div className="space-y-2">
                {reminders.anniversaries.slice(0, 6).map(b => (
                  <div key={b.id} className="flex items-center justify-between text-sm">
                    <div><span className="font-medium">{b.name}</span> <span className="text-muted-foreground">· {b.phone}</span></div>
                    <div className="text-xs px-2 py-1 rounded-full bg-rose-200 text-rose-800">{b.daysUntil === 0 ? 'Today' : `in ${b.daysUntil}d`}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e: any) => setSearch(e.target.value)} onKeyDown={(e: any) => e.key === 'Enter' && load()} placeholder="Search name or phone…" className="pl-9" />
          </div>
          <Select value={segment} onChange={(e: any) => setSegment(e.target.value)}>
            {SEGMENTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
          <Button variant="ghost" onClick={load}>Apply</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Phone</th>
                <th className="py-2 pr-4">Visits</th>
                <th className="py-2 pr-4">Total Spend</th>
                <th className="py-2 pr-4">Avg Order</th>
                <th className="py-2 pr-4">Last Visit</th>
                <th className="py-2 pr-4">Segment</th>
                <th className="py-2 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Loading…</td></tr>}
              {!loading && list.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No customers yet. Add a customer or capture a phone number on a sales invoice.</td></tr>}
              {list.map(c => (
                <tr key={c.id} className="border-b hover:bg-muted/30">
                  <td className="py-2 pr-4 font-medium">{c.name}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{c.phone}</td>
                  <td className="py-2 pr-4">{c.totalVisits}</td>
                  <td className="py-2 pr-4">{formatCurrency(c.totalSpent)}</td>
                  <td className="py-2 pr-4">{formatCurrency(c.avgOrderValue)}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{c.lastVisitDate ? formatDate(c.lastVisitDate) : '—'}</td>
                  <td className="py-2 pr-4"><span className={`text-xs px-2 py-1 rounded-full ${SEG_COLOR[c.segment] || ''}`}>{c.segment.replace('_', ' ')}</span></td>
                  <td className="py-2 pr-4">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openDetail(c)} className="p-1.5 hover:bg-muted rounded" title="View"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-muted rounded" title="Edit"><Edit2 className="w-4 h-4" /></button>
                      {isAdmin && <button onClick={() => del(c)} className="p-1.5 hover:bg-muted rounded text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={modal} onClose={() => setModal(false)} title={editing ? 'Edit Customer' : 'New Customer'} maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button><Button onClick={save}>{editing ? 'Save' : 'Create'}</Button></>}>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Name *</Label><Input value={form.name} onChange={(e: any) => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Phone *</Label><Input type="tel" value={form.phone} onChange={(e: any) => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="9876543210" /></div>
          </div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e: any) => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Birthday</Label><Input type="date" value={form.birthday} onChange={(e: any) => setForm(f => ({ ...f, birthday: e.target.value }))} /></div>
            <div><Label>Anniversary</Label><Input type="date" value={form.anniversary} onChange={(e: any) => setForm(f => ({ ...f, anniversary: e.target.value }))} /></div>
          </div>
          <div><Label>Notes</Label><Input value={form.notes} onChange={(e: any) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Preferences, allergies, occasion notes…" /></div>
        </div>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.name} · ${detail.phone}` : ''} maxWidth="max-w-3xl"
        footer={<Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>}>
        {detail && (
          <div className="space-y-5 py-2 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Visits" value={detail.totalVisits} />
              <Stat label="Total Spend" value={formatCurrency(detail.totalSpent)} />
              <Stat label="Avg Order" value={formatCurrency(detail.avgOrderValue)} />
              <Stat label="Last Visit" value={detail.lastVisitDate ? formatDate(detail.lastVisitDate) : '—'} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border p-4">
                <div className="text-sm font-semibold mb-3">Top 3 Items</div>
                {detail.topItems.length === 0 ? <div className="text-sm text-muted-foreground">No history yet</div> :
                  <div className="space-y-2">
                    {detail.topItems.map((t: any) => (
                      <div key={t.itemId} className="flex justify-between text-sm">
                        <span>{t.itemName}</span>
                        <span className="text-muted-foreground">{t.qty} × · {formatCurrency(t.spend)}</span>
                      </div>
                    ))}
                  </div>}
              </div>
              <div className="rounded-xl border p-4">
                <div className="text-sm font-semibold mb-3">Profile</div>
                <div className="text-sm space-y-1">
                  <div><span className="text-muted-foreground">Preferred payment:</span> <span className="uppercase">{detail.preferredPaymentMode}</span></div>
                  <div><span className="text-muted-foreground">Preferred order:</span> <span className="uppercase">{detail.preferredOrderType}</span></div>
                  <div><span className="text-muted-foreground">Birthday:</span> {detail.birthday ? formatDate(detail.birthday) : '—'}</div>
                  <div><span className="text-muted-foreground">Anniversary:</span> {detail.anniversary ? formatDate(detail.anniversary) : '—'}</div>
                  <div className="pt-2"><span className="text-muted-foreground">Time pattern:</span></div>
                  <div className="flex gap-2 text-xs">
                    {Object.entries(detail.timePattern).map(([k, v]: any) => (
                      <span key={k} className="px-2 py-1 rounded-full bg-muted">{k}: {v}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold mb-2">Visit History ({detail.visits.length})</div>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Invoice</th>
                      <th className="px-3 py-2">Order</th>
                      <th className="px-3 py-2">Pay</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.visits.map((v: any) => (
                      <tr key={v.id} className="border-t">
                        <td className="px-3 py-2">{formatDate(v.salesDate)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{v.invoiceTime || '—'}</td>
                        <td className="px-3 py-2 font-mono">{v.invoiceNo}</td>
                        <td className="px-3 py-2 uppercase">{v.orderType}</td>
                        <td className="px-3 py-2 uppercase">{v.paymentMode}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(v.finalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!dupConfirm} onClose={() => setDupConfirm(null)} title={dupConfirm?.kind === 'exact' ? 'Possible duplicate found' : 'Similar name found'}
        footer={<><Button variant="ghost" onClick={() => setDupConfirm(null)} data-testid="customer-dup-cancel">Cancel</Button><Button onClick={handleConfirmDuplicate} data-testid="customer-dup-confirm">{dupConfirm?.kind === 'exact' ? 'Save anyway' : 'Create anyway'}</Button></>}>
        <div className="py-2 space-y-3 text-sm">
          <p className="text-muted-foreground">{dupConfirm?.message}</p>
          {dupConfirm?.matches && dupConfirm.matches.length > 0 && (
            <div className="border rounded-lg divide-y" data-testid="customer-dup-matches">
              {dupConfirm.matches.slice(0, 5).map((m: any) => (
                <div key={m.id} className="p-2.5 flex items-center justify-between text-xs">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted-foreground">{m.matchType !== 'exact' ? (m.matchType === 'stem' ? 'singular/plural' : '1-letter diff') : 'same name'}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {dupConfirm?.kind === 'exact'
              ? 'Confirming will save this customer even though one with the same name exists.'
              : 'Confirming will create this as a separate customer. Use only if it really is a different person.'}
          </p>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}
