import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from '../lib/api';
import { PageHeader, Badge, Button, Input, Label, Modal, formatCurrency, cn } from '../components/ui-extras';
import { useAuth } from '../lib/auth';
import { Plus, RefreshCw, Edit2, Trash2, Users, Clock, TableIcon, CalendarCheck, ChevronDown, ChevronUp, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '../hooks/use-toast';


function getToday() { return new Date().toISOString().split('T')[0]; }
function getNow() { return new Date().toISOString(); }

type TableStatus = 'free' | 'occupied' | 'reserved' | 'cleaning';

interface RestaurantTable {
  id: number; name: string; section: string; capacity: number;
  tableType: string; displayX: number; displayY: number;
  status: TableStatus; active: boolean;
}
interface TableSession {
  id: number; tableId: number; invoiceId?: number; coverCount: number;
  openedAt: string; closedAt?: string; notes?: string;
}
interface Reservation {
  id: number; tableId?: number; guestName: string; guestPhone?: string;
  partySize: number; reservedAt: string; status: string; notes?: string;
}

const STATUS_COLORS: Record<TableStatus, string> = {
  free: 'bg-emerald-100 border-emerald-400 text-emerald-800',
  occupied: 'bg-red-100 border-red-400 text-red-800',
  reserved: 'bg-amber-100 border-amber-400 text-amber-800',
  cleaning: 'bg-yellow-100 border-yellow-400 text-yellow-800',
};
const STATUS_DOT: Record<TableStatus, string> = {
  free: 'bg-emerald-500', occupied: 'bg-red-500',
  reserved: 'bg-amber-500', cleaning: 'bg-yellow-500',
};

export default function TablesPage() {
  const { hasPerm } = useAuth();
  const { toast } = useToast();
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [sessions, setSessions] = useState<Record<number, TableSession>>({});
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'floorplan' | 'reservations'>('floorplan');
  const [showTableModal, setShowTableModal] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState<RestaurantTable | null>(null);
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [editTable, setEditTable] = useState<RestaurantTable | null>(null);
  const [form, setForm] = useState({ name: '', section: 'Indoor', capacity: 4, tableType: 'square' });
  const [sessionForm, setSessionForm] = useState({ coverCount: 2, notes: '', invoiceId: '' });
  const [resForm, setResForm] = useState({ guestName: '', guestPhone: '', partySize: 2, reservedAt: '', tableId: '', notes: '', status: 'pending' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tbls, res] = await Promise.all([
        apiFetch('/tables').then((r: Response) => r.json()),
        apiFetch('/table-reservations').then((r: Response) => r.json()).catch(() => []),
      ]);
      const tblArr: RestaurantTable[] = Array.isArray(tbls) ? tbls : [];
      setTables(tblArr);
      setReservations(Array.isArray(res) ? res : []);
      // Load active sessions
      const sessMap: Record<number, TableSession> = {};
      await Promise.all(tblArr.filter(t => t.status === 'occupied').map(async t => {
        const s = await apiFetch(`/tables/${t.id}/sessions`).then((r: Response) => r.json()).catch(() => []);
        const active = Array.isArray(s) ? s.find((x: TableSession) => !x.closedAt) : null;
        if (active) sessMap[t.id] = active;
      }));
      setSessions(sessMap);
    } catch (e) { toast({ title: 'Error loading tables', variant: 'destructive' }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const iv = setInterval(load, 60000); return () => clearInterval(iv); }, [load]);

  const saveTable = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const url = editTable ? `/tables/${editTable.id}` : '/tables';
      const method = editTable ? 'PATCH' : 'POST';
      const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      toast({ title: editTable ? 'Table updated' : 'Table created' });
      setShowTableModal(false); setEditTable(null); setForm({ name: '', section: 'Indoor', capacity: 4, tableType: 'square' });
      load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  const changeStatus = async (table: RestaurantTable, status: TableStatus) => {
    try {
      await apiFetch(`/tables/${table.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      load();
    } catch { toast({ title: 'Failed to update status', variant: 'destructive' }); }
  };

  const openSession = async () => {
    if (!showSessionModal) return;
    setSaving(true);
    try {
      const r = await apiFetch('/table-sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: showSessionModal.id, coverCount: Number(sessionForm.coverCount), notes: sessionForm.notes }),
      });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      await apiFetch(`/tables/${showSessionModal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'occupied' }) });
      toast({ title: 'Session opened' }); setShowSessionModal(null); load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  const closeSession = async (tableId: number, sessionId: number) => {
    try {
      await apiFetch(`/table-sessions/${sessionId}/close`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      await apiFetch(`/tables/${tableId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'free' }) });
      toast({ title: 'Session closed' }); load();
    } catch { toast({ title: 'Failed to close session', variant: 'destructive' }); }
  };

  const saveReservation = async () => {
    if (!resForm.guestName || !resForm.reservedAt) return;
    setSaving(true);
    try {
      const url = '/table-reservations';
      const body = { ...resForm, tableId: resForm.tableId ? Number(resForm.tableId) : undefined, partySize: Number(resForm.partySize) };
      const r = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      toast({ title: 'Reservation created' }); setShowReservationModal(false);
      setResForm({ guestName: '', guestPhone: '', partySize: 2, reservedAt: '', tableId: '', notes: '', status: 'pending' });
      load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  const updateReservation = async (id: number, status: string) => {
    try {
      await apiFetch(`/table-reservations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      load();
    } catch { toast({ title: 'Failed to update reservation', variant: 'destructive' }); }
  };

  const sections = [...new Set(tables.map(t => t.section))];
  const statusCount = (s: TableStatus) => tables.filter(t => t.status === s).length;

  const getElapsed = (openedAt: string) => {
    const ms = Date.now() - new Date(openedAt).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Table Management" description="Floor plan, occupancy and reservations">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          {hasPerm('tables.edit') && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowReservationModal(true)}><CalendarCheck className="w-4 h-4 mr-1" />New Reservation</Button>
              <Button size="sm" onClick={() => { setEditTable(null); setForm({ name: '', section: 'Indoor', capacity: 4, tableType: 'square' }); setShowTableModal(true); }}><Plus className="w-4 h-4 mr-1" />Add Table</Button>
            </>
          )}
        </div>
      </PageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(['free','occupied','reserved','cleaning'] as TableStatus[]).map(s => (
          <div key={s} className="rounded-2xl bg-card border p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('w-2.5 h-2.5 rounded-full', STATUS_DOT[s])} />
              <span className="text-sm capitalize text-muted-foreground">{s}</span>
            </div>
            <div className="text-3xl font-bold">{statusCount(s)}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/60 rounded-xl p-1 w-fit">
        {(['floorplan','reservations'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize',
              activeTab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {t === 'floorplan' ? 'Floor Plan' : 'Reservations'}
          </button>
        ))}
      </div>

      {activeTab === 'floorplan' && (
        <div className="space-y-6">
          {loading ? <div className="text-center py-12 text-muted-foreground">Loading tables…</div> :
            tables.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <TableIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No tables configured</p>
                <p className="text-sm">Add your first table to get started</p>
              </div>
            ) : sections.map(section => (
              <div key={section}>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{section}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {tables.filter(t => t.section === section).map(table => {
                    const session = sessions[table.id];
                    return (
                      <div key={table.id} className={cn('rounded-2xl border-2 p-4 transition-all', STATUS_COLORS[table.status as TableStatus] || 'bg-card border-border')}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-bold text-lg">{table.name}</p>
                            <p className="text-xs opacity-70">{table.capacity} seats · {table.tableType}</p>
                          </div>
                          {hasPerm('tables.edit') && (
                            <button onClick={() => { setEditTable(table); setForm({ name: table.name, section: table.section, capacity: table.capacity, tableType: table.tableType }); setShowTableModal(true); }}
                              className="p-1 rounded-lg hover:bg-black/10">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mb-3">
                          <span className={cn('w-2 h-2 rounded-full', STATUS_DOT[table.status as TableStatus])} />
                          <span className="text-xs font-medium capitalize">{table.status}</span>
                          {session && <span className="text-xs ml-auto opacity-70"><Clock className="w-3 h-3 inline" /> {getElapsed(session.openedAt)}</span>}
                        </div>
                        {session && (
                          <p className="text-xs opacity-70 mb-2"><Users className="w-3 h-3 inline mr-1" />{session.coverCount} covers</p>
                        )}
                        {hasPerm('tables.edit') && (
                          <div className="flex flex-col gap-1.5 mt-2">
                            {table.status === 'free' && (
                              <button onClick={() => { setShowSessionModal(table); setSessionForm({ coverCount: 2, notes: '', invoiceId: '' }); }}
                                className="w-full text-xs py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
                                Open Table
                              </button>
                            )}
                            {table.status === 'occupied' && session && (
                              <button onClick={() => closeSession(table.id, session.id)}
                                className="w-full text-xs py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700">
                                Close Table
                              </button>
                            )}
                            {table.status !== 'free' && (
                              <select value={table.status} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => changeStatus(table, e.target.value as TableStatus)}
                                className="w-full text-xs py-1.5 rounded-lg border border-current bg-transparent">
                                {(['free','occupied','reserved','cleaning'] as TableStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          }
        </div>
      )}

      {activeTab === 'reservations' && (
        <div className="rounded-2xl bg-card border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {['Guest','Phone','Party','Table','Time','Status','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reservations.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No reservations found</td></tr>
              ) : reservations.map(r => {
                const tbl = tables.find(t => t.id === r.tableId);
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{r.guestName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.guestPhone || '—'}</td>
                    <td className="px-4 py-3">{r.partySize}</td>
                    <td className="px-4 py-3">{tbl?.name || 'Any'}</td>
                    <td className="px-4 py-3">{new Date(r.reservedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                        r.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                        r.status === 'seated' ? 'bg-blue-100 text-blue-700' :
                        r.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700')}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {r.status === 'pending' && <button onClick={() => updateReservation(r.id, 'confirmed')} className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200">Confirm</button>}
                        {r.status === 'confirmed' && <button onClick={() => updateReservation(r.id, 'seated')} className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200">Seated</button>}
                        {!['cancelled','no-show'].includes(r.status) && <button onClick={() => updateReservation(r.id, 'cancelled')} className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">Cancel</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Table modal */}
      <Modal open={showTableModal} onClose={() => { setShowTableModal(false); setEditTable(null); }} title={editTable ? 'Edit Table' : 'Add Table'}>
        <div className="space-y-4">
          <div><Label>Table Name *</Label><Input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. T01" /></div>
          <div><Label>Section</Label>
            <select value={form.section} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, section: e.target.value }))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm">
              {['Indoor','Outdoor','Bar','Private Room'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div><Label>Capacity</Label><Input type="number" min={1} value={form.capacity} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, capacity: Number(e.target.value) }))} /></div>
          <div><Label>Type</Label>
            <select value={form.tableType} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, tableType: e.target.value }))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm">
              {['square','round','rectangular'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <Button onClick={saveTable} disabled={saving} className="w-full">{saving ? 'Saving…' : editTable ? 'Update Table' : 'Create Table'}</Button>
        </div>
      </Modal>

      {/* Open session modal */}
      <Modal open={!!showSessionModal} onClose={() => setShowSessionModal(null)} title={`Open Table — ${showSessionModal?.name}`}>
        <div className="space-y-4">
          <div><Label>Cover Count *</Label><Input type="number" min={1} value={sessionForm.coverCount} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setSessionForm(f => ({ ...f, coverCount: Number(e.target.value) }))} /></div>
          <div><Label>Notes</Label><Input value={sessionForm.notes} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setSessionForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Birthday party" /></div>
          <Button onClick={openSession} disabled={saving} className="w-full">{saving ? 'Opening…' : 'Open Table'}</Button>
        </div>
      </Modal>

      {/* Reservation modal */}
      <Modal open={showReservationModal} onClose={() => setShowReservationModal(false)} title="New Reservation">
        <div className="space-y-4">
          <div><Label>Guest Name *</Label><Input value={resForm.guestName} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setResForm(f => ({ ...f, guestName: e.target.value }))} /></div>
          <div><Label>Phone</Label><Input value={resForm.guestPhone} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setResForm(f => ({ ...f, guestPhone: e.target.value }))} /></div>
          <div><Label>Party Size</Label><Input type="number" min={1} value={resForm.partySize} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setResForm(f => ({ ...f, partySize: Number(e.target.value) }))} /></div>
          <div><Label>Date & Time *</Label><Input type="datetime-local" value={resForm.reservedAt} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setResForm(f => ({ ...f, reservedAt: e.target.value }))} /></div>
          <div><Label>Table (optional)</Label>
            <select value={resForm.tableId} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setResForm(f => ({ ...f, tableId: e.target.value }))} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm">
              <option value="">Any available table</option>
              {tables.map(t => <option key={t.id} value={t.id}>{t.name} ({t.section})</option>)}
            </select>
          </div>
          <div><Label>Notes</Label><Input value={resForm.notes} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setResForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <Button onClick={saveReservation} disabled={saving} className="w-full">{saving ? 'Saving…' : 'Create Reservation'}</Button>
        </div>
      </Modal>
    </div>
  );
}
