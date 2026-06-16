import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from '../lib/api';
import { PageHeader, Button, Input, Label, Badge, formatCurrency, Modal, cn } from '../components/ui-extras';
import { useAuth } from '../lib/auth';
import { Plus, ShoppingCart, Check, X, Send, RefreshCw } from 'lucide-react';
import { useToast } from '../hooks/use-toast';


type POStatus = 'draft'|'submitted'|'approved'|'sent_to_vendor'|'partially_received'|'received'|'cancelled';

interface POLine { ingredientId: number; ingredientName?: string; qtyOrdered: number; unitPrice: number; uom?: string; }
interface PurchaseOrder {
  id: number; poNumber: string; vendorId: number; vendorName?: string;
  status: POStatus; requiredBy?: string; totalAmount: number; notes?: string;
  createdAt: string; approvedAt?: string; lines?: POLine[];
}
interface Vendor { id: number; name: string; code: string; }
interface Ingredient { id: number; name: string; code: string; }

const STATUS_STEPS: POStatus[] = ['draft','submitted','approved','sent_to_vendor','partially_received','received'];
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700', submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700', sent_to_vendor: 'bg-purple-100 text-purple-700',
  partially_received: 'bg-amber-100 text-amber-700', received: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function PurchaseOrdersPage() {
  const { hasPerm, user } = useAuth();
  const { toast } = useToast();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ vendorId: '', requiredBy: '', notes: '' });
  const [lines, setLines] = useState<{ ingredientId: string; qtyOrdered: number; unitPrice: number; uom: string }[]>([
    { ingredientId: '', qtyOrdered: 1, unitPrice: 0, uom: 'kg' }
  ]);

  const isAdmin = user?.role === 'admin' || user?.role === 'owner';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [poData, vendorData, ingData] = await Promise.all([
        apiFetch('/purchase-orders').then((r: Response) => r.json()),
        apiFetch('/vendors').then((r: Response) => r.json()),
        apiFetch('/ingredients?limit=500').then((r: Response) => r.json()),
      ]);
      setPos(Array.isArray(poData) ? poData : []);
      setVendors(Array.isArray(vendorData) ? vendorData : []);
      setIngredients(Array.isArray(ingData) ? ingData : ingData?.data || []);
    } catch { toast({ title: 'Failed to load data', variant: 'destructive' }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createPO = async () => {
    if (!form.vendorId) return;
    const validLines = lines.filter(l => l.ingredientId);
    if (validLines.length === 0) return;
    setSaving(true);
    try {
      const r = await apiFetch('/purchase-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId: Number(form.vendorId), requiredBy: form.requiredBy || null, notes: form.notes, lines: validLines.map(l => ({ ...l, ingredientId: Number(l.ingredientId) })) }),
      });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      toast({ title: 'Purchase Order created' }); setShowModal(false);
      setForm({ vendorId: '', requiredBy: '', notes: '' });
      setLines([{ ingredientId: '', qtyOrdered: 1, unitPrice: 0, uom: 'kg' }]);
      load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  const updateStatus = async (poId: number, action: string) => {
    setSaving(true);
    try {
      const r = await apiFetch(`/purchase-orders/${poId}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      toast({ title: 'PO updated' }); load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  const loadDetail = async (po: PurchaseOrder) => {
    const data = await apiFetch(`/purchase-orders/${po.id}`).then((r: Response) => r.json());
    setSelected(data);
  };

  const addLine = () => setLines(prev => [...prev, { ingredientId: '', qtyOrdered: 1, unitPrice: 0, uom: 'kg' }]);
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));
  const lineTotal = lines.reduce((s, l) => s + (l.qtyOrdered * l.unitPrice), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Purchase Orders" description="PO workflow from draft to receipt">
        {hasPerm('purchases.edit') && (
          <Button size="sm" onClick={() => setShowModal(true)}><Plus className="w-4 h-4 mr-1" />New PO</Button>
        )}
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(['draft','submitted','approved','received'] as POStatus[]).map(s => (
          <div key={s} className="rounded-2xl bg-card border p-4">
            <p className="text-sm capitalize text-muted-foreground">{s.replace('_', ' ')}</p>
            <p className="text-3xl font-bold">{pos.filter(p => p.status === s).length}</p>
          </div>
        ))}
      </div>

      {loading ? <div className="text-center py-12 text-muted-foreground">Loading…</div> :
        <div className="rounded-2xl bg-card border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>{['PO Number','Vendor','Status','Amount','Required By','Created','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {pos.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No purchase orders yet</td></tr>
              ) : pos.map(po => (
                <tr key={po.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-primary cursor-pointer" onClick={() => loadDetail(po)}>{po.poNumber}</td>
                  <td className="px-4 py-3">{po.vendorName}</td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLOR[po.status] || 'bg-gray-100 text-gray-600')}>
                      {po.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{formatCurrency(po.totalAmount)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{po.requiredBy || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(po.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {po.status === 'draft' && hasPerm('purchases.edit') && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus(po.id, 'submit')}>Submit</Button>
                      )}
                      {po.status === 'submitted' && isAdmin && (
                        <>
                          <Button size="sm" onClick={() => updateStatus(po.id, 'approve')} className="bg-emerald-600 hover:bg-emerald-700 text-white">Approve</Button>
                          <Button size="sm" variant="destructive" onClick={() => updateStatus(po.id, 'cancel')}>Reject</Button>
                        </>
                      )}
                      {po.status === 'approved' && hasPerm('purchases.edit') && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus(po.id, 'send')}>Send to Vendor</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }

      {/* Create PO Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Create Purchase Order">
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          <div><Label>Vendor *</Label>
            <select value={form.vendorId} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, vendorId: e.target.value }))}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm">
              <option value="">Select vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </select>
          </div>
          <div><Label>Required By</Label><Input type="date" value={form.requiredBy} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, requiredBy: e.target.value }))} /></div>
          <div><Label>Notes</Label><Input value={form.notes} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, notes: e.target.value }))} /></div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Line Items *</Label>
              <Button size="sm" variant="outline" onClick={addLine}>+ Add Line</Button>
            </div>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-1.5 items-end">
                  <div className="col-span-5">
                    <select value={line.ingredientId} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ingredientId: e.target.value } : l))}
                      className="w-full rounded-xl border border-input bg-background px-2 py-1.5 text-sm">
                      <option value="">Ingredient…</option>
                      {ingredients.map(ing => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Input type="number" min={0.01} step="0.01" placeholder="Qty" value={line.qtyOrdered}
                      onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qtyOrdered: Number(e.target.value) } : l))} />
                  </div>
                  <div className="col-span-2">
                    <Input type="text" placeholder="UOM" value={line.uom}
                      onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, uom: e.target.value } : l))} />
                  </div>
                  <div className="col-span-2">
                    <Input type="number" min={0} step="0.01" placeholder="Price" value={line.unitPrice}
                      onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, unitPrice: Number(e.target.value) } : l))} />
                  </div>
                  <div className="col-span-1">
                    <Button size="sm" variant="ghost" onClick={() => removeLine(i)} className="text-red-500 px-2">×</Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 p-3 rounded-xl bg-muted/40 flex justify-between font-semibold">
              <span>Total</span><span>{formatCurrency(lineTotal)}</span>
            </div>
          </div>
          <Button onClick={createPO} disabled={saving || !form.vendorId} className="w-full">
            {saving ? 'Creating…' : 'Create Purchase Order'}
          </Button>
        </div>
      </Modal>

      {/* Detail modal */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={`PO ${selected.poNumber}`}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Vendor:</span> <span className="font-medium">{selected.vendorName}</span></div>
              <div><span className="text-muted-foreground">Status:</span> <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium ml-1', STATUS_COLOR[selected.status])}>{selected.status}</span></div>
              <div><span className="text-muted-foreground">Total:</span> <span className="font-bold">{formatCurrency(selected.totalAmount)}</span></div>
              <div><span className="text-muted-foreground">Required By:</span> <span>{selected.requiredBy || '—'}</span></div>
            </div>
            {selected.lines && selected.lines.length > 0 && (
              <table className="w-full text-sm mt-2">
                <thead><tr className="bg-muted/40">
                  <th className="px-3 py-2 text-left">Ingredient</th>
                  <th className="px-3 py-2 text-left">Ordered</th>
                  <th className="px-3 py-2 text-left">Unit Price</th>
                  <th className="px-3 py-2 text-left">Amount</th>
                </tr></thead>
                <tbody>
                  {selected.lines.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{l.ingredientName}</td>
                      <td className="px-3 py-2">{l.qtyOrdered} {l.uom}</td>
                      <td className="px-3 py-2">{formatCurrency(l.unitPrice)}</td>
                      <td className="px-3 py-2">{formatCurrency(l.qtyOrdered * l.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
