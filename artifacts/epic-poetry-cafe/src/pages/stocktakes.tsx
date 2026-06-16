import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from '../lib/api';
import { PageHeader, Button, Input, Label, Badge, formatCurrency, cn } from '../components/ui-extras';
import { useAuth } from '../lib/auth';
import { Plus, CheckCircle, AlertTriangle, Package, ClipboardList, RefreshCw } from 'lucide-react';
import { useToast } from '../hooks/use-toast';

function r2(n: number) { return Math.round((n || 0) * 100) / 100; }

interface StocktakeLine {
  id: number; ingredientId: number; ingredientName: string; ingredientCode: string;
  uom: string; expectedQty: number; actualQty: number | null; variance: number | null;
  varianceCost: number; counted: boolean;
}
interface Stocktake {
  id: number; stocktakeNumber: string; scope: string; status: string;
  totalVarianceCost: number; frozenAt: string; approvedAt?: string;
  initiatedBy?: number; approvedBy?: number; notes?: string;
  lines?: StocktakeLine[];
}

const STATUS_COLOR: Record<string, string> = {
  in_progress: 'bg-blue-100 text-blue-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function StocktakePage() {
  const { hasPerm, user } = useAuth();
  const { toast } = useToast();
  const [stocktakes, setStocktakes] = useState<Stocktake[]>([]);
  const [active, setActive] = useState<Stocktake | null>(null);
  const [lines, setLines] = useState<StocktakeLine[]>([]);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'list' | 'count'>('list');
  const [form, setForm] = useState({ scope: 'full', notes: '' });
  const [showForm, setShowForm] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'owner';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/stocktakes').then((r: Response) => r.json());
      setStocktakes(Array.isArray(data) ? data : []);
    } catch { toast({ title: 'Failed to load stocktakes', variant: 'destructive' }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadActive = async (id: number) => {
    const data = await apiFetch(`/stocktakes/${id}`).then((r: Response) => r.json());
    setActive(data);
    setLines(data.lines || []);
    const initCounts: Record<number, string> = {};
    for (const l of (data.lines || [])) {
      if (l.actualQty !== null && l.actualQty !== undefined) initCounts[l.id] = String(l.actualQty);
    }
    setCounts(initCounts);
    setView('count');
  };

  const initiate = async () => {
    setSaving(true);
    try {
      const r = await apiFetch('/stocktakes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      const data = await r.json();
      toast({ title: `Stocktake ${data.stocktakeNumber} initiated` });
      setShowForm(false); await load(); await loadActive(data.id);
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  const saveCount = async (lineId: number, actualQty: number) => {
    try {
      await apiFetch(`/stocktake-lines/${lineId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actualQty, counted: true }),
      });
      // Update local lines
      setLines(prev => prev.map(l => l.id === lineId ? {
        ...l, actualQty, counted: true, variance: r2(actualQty - l.expectedQty),
      } : l));
    } catch { toast({ title: 'Failed to save count', variant: 'destructive' }); }
  };

  const submitForApproval = async () => {
    if (!active) return;
    setSaving(true);
    try {
      // Save all pending counts first
      for (const [lineId, val] of Object.entries(counts)) {
        const line = lines.find(l => l.id === Number(lineId));
        if (line && !line.counted) await saveCount(Number(lineId), Number(val));
      }
      const r = await apiFetch(`/stocktakes/${active.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      toast({ title: 'Submitted for admin approval' }); load(); setView('list');
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  const approve = async (id: number) => {
    setSaving(true);
    try {
      const r = await apiFetch(`/stocktakes/${id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      toast({ title: 'Stocktake approved — stock updated' }); load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  const uncounted = lines.filter(l => !l.counted && counts[l.id] === undefined).length;
  const variances = lines.filter(l => l.counted && l.variance !== null && l.variance !== 0);
  const totalVarianceCost = r2(variances.reduce((s, l) => s + Math.abs(l.varianceCost), 0));

  if (view === 'count' && active) {
    return (
      <div className="space-y-6">
        <PageHeader title={`Stocktake — ${active.stocktakeNumber}`} description={`${active.scope} count · Frozen: ${new Date(active.frozenAt).toLocaleString()}`}>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setView('list'); load(); }}>Back to List</Button>
            {active.status === 'in_progress' && (
              <Button size="sm" onClick={submitForApproval} disabled={saving}>{saving ? 'Submitting…' : 'Submit for Approval'}</Button>
            )}
          </div>
        </PageHeader>

        {/* Progress */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-2xl bg-card border p-4 text-center">
            <div className="text-3xl font-bold text-emerald-600">{lines.filter(l => l.counted).length}</div>
            <div className="text-sm text-muted-foreground">Counted</div>
          </div>
          <div className="rounded-2xl bg-card border p-4 text-center">
            <div className="text-3xl font-bold text-amber-600">{uncounted}</div>
            <div className="text-sm text-muted-foreground">Remaining</div>
          </div>
          <div className="rounded-2xl bg-card border p-4 text-center">
            <div className="text-3xl font-bold text-red-600">{variances.length}</div>
            <div className="text-sm text-muted-foreground">Variances</div>
          </div>
        </div>

        {/* Count table */}
        <div className="rounded-2xl bg-card border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {['#','Ingredient','UOM','Expected','Actual Count','Variance','Cost Impact','Status'].map(h => (
                  <th key={h} className="px-3 py-3 text-left font-medium text-muted-foreground text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const val = counts[line.id] ?? (line.actualQty !== null ? String(line.actualQty) : '');
                const variance = val !== '' ? r2(Number(val) - line.expectedQty) : null;
                return (
                  <tr key={line.id} className={cn('border-t hover:bg-muted/20', line.counted && 'bg-emerald-50/40')}>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{line.ingredientName}</p>
                      <p className="text-xs text-muted-foreground">{line.ingredientCode}</p>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{line.uom}</td>
                    <td className="px-3 py-2 font-medium">{r2(line.expectedQty)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Input type="number" min={0} step="0.01" placeholder="0"
                          value={val}
                          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setCounts(prev => ({ ...prev, [line.id]: e.target.value }))}
                          onBlur={() => { if (val !== '') saveCount(line.id, Number(val)); }}
                          className="w-24 text-center h-8 text-sm"
                          disabled={active.status !== 'in_progress'} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {variance !== null && (
                        <span className={cn('font-medium text-sm', variance < 0 ? 'text-red-600' : variance > 0 ? 'text-blue-600' : 'text-emerald-600')}>
                          {variance > 0 ? '+' : ''}{variance}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatCurrency(line.varianceCost)}</td>
                    <td className="px-3 py-2">
                      {line.counted ? <span className="text-xs text-emerald-600 font-medium">✓ Counted</span> :
                        val ? <span className="text-xs text-amber-600">Pending save</span> :
                        <span className="text-xs text-muted-foreground">Not counted</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {variances.length > 0 && (
          <div className="rounded-2xl bg-red-50 border border-red-200 p-4">
            <p className="font-semibold text-red-800 mb-2">Variance Summary</p>
            <div className="space-y-1">
              {variances.map(l => (
                <div key={l.id} className="flex justify-between text-sm">
                  <span>{l.ingredientName}</span>
                  <span className={l.variance! < 0 ? 'text-red-600' : 'text-blue-600'}>
                    {l.variance! > 0 ? '+' : ''}{r2(l.variance!)} {l.uom} ({formatCurrency(Math.abs(l.varianceCost))})
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t mt-2 pt-2 flex justify-between font-bold">
              <span>Total Variance Cost</span><span className="text-red-700">{formatCurrency(totalVarianceCost)}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Stocktake / Physical Count" description="Guided inventory counting with variance report">
        {hasPerm('inventory.edit') && (
          <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4 mr-1" />New Stocktake</Button>
        )}
      </PageHeader>

      {showForm && (
        <div className="rounded-2xl bg-card border p-5 space-y-4">
          <h3 className="font-semibold">Initiate New Stocktake</h3>
          <div><Label>Scope</Label>
            <select value={form.scope} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, scope: e.target.value }))}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm">
              <option value="full">Full Count (all ingredients)</option>
              <option value="category">By Category</option>
              <option value="custom">Custom List</option>
            </select>
          </div>
          <div><Label>Notes</Label><Input value={form.notes} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. End of month count" /></div>
          <div className="flex gap-2">
            <Button onClick={initiate} disabled={saving}>{saving ? 'Initiating…' : 'Start Stocktake'}</Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? <div className="text-center py-12 text-muted-foreground">Loading…</div> :
        stocktakes.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No stocktakes yet</p>
            <p className="text-sm">Initiate your first physical count</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-card border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>{['Number','Scope','Status','Variance Cost','Frozen At','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {stocktakes.map(s => (
                  <tr key={s.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{s.stocktakeNumber}</td>
                    <td className="px-4 py-3 capitalize">{s.scope}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLOR[s.status] || 'bg-gray-100 text-gray-600')}>
                        {s.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-red-600">{formatCurrency(s.totalVarianceCost)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(s.frozenAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => loadActive(s.id)}>
                          {s.status === 'in_progress' ? 'Continue' : 'View'}
                        </Button>
                        {s.status === 'pending_approval' && isAdmin && (
                          <Button size="sm" onClick={() => approve(s.id)} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">Approve</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}
