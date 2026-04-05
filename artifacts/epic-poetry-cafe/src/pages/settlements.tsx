import React, { useState } from 'react';
import { useListSettlements, useCreateSettlement, useGetSettlementSalesSummary, useVerifySettlement, useDeleteSettlement, useGetSettlement, useUpdateSettlement } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Modal, formatCurrency, formatDate, StatCard, DateFilter } from '../components/ui-extras';
import { Plus, CheckCircle, AlertTriangle, XCircle, Banknote, CreditCard, QrCode, Trash2, Eye, ShieldCheck, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';

const PAYMENT_MODES = ['Cash', 'Card', 'QR', 'UPI', 'Bank Transfer', 'Swiggy', 'Zomato', 'Other'];

function StatusBadge({ type, status }: { type: string; status: string }) {
  if (status === 'verified') return <span className="px-2.5 py-0.5 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-700">Verified</span>;
  if (type === 'matched') return <span className="px-2.5 py-0.5 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-700">Matched</span>;
  if (type === 'short') return <span className="px-2.5 py-0.5 rounded-lg text-xs font-medium bg-amber-100 text-amber-700">Short</span>;
  if (type === 'excess') return <span className="px-2.5 py-0.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-700">Excess</span>;
  return <span className="px-2.5 py-0.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700">{status}</span>;
}

export default function Settlements() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const isViewer = user?.role === 'viewer';
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const filterParams = { ...(filterFrom ? { fromDate: filterFrom } : {}), ...(filterTo ? { toDate: filterTo } : {}) };
  const { data: settlements, isLoading } = useListSettlements(Object.keys(filterParams).length ? filterParams : undefined);
  const createMut = useCreateSettlement();
  const updateMut = useUpdateSettlement();
  const verifyMut = useVerifySettlement();
  const deleteMut = useDeleteSettlement();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [detailModal, setDetailModal] = useState<number | null>(null);
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().split('T')[0]);
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<{ paymentMode: string; amount: string; referenceNote: string }[]>([
    { paymentMode: 'Cash', amount: '', referenceNote: '' },
    { paymentMode: 'Card', amount: '', referenceNote: '' },
    { paymentMode: 'QR', amount: '', referenceNote: '' },
  ]);

  const { data: salesSummary } = useGetSettlementSalesSummary({ date: settlementDate }, { query: { enabled: isModalOpen } });
  const { data: detail } = useGetSettlement(detailModal || 0, { query: { enabled: !!detailModal } });

  const totalSettlement = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const netSales = salesSummary?.netSales || 0;
  const difference = netSales - totalSettlement;

  const addLine = () => setLines([...lines, { paymentMode: '', amount: '', referenceNote: '' }]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: string, value: string) => {
    const updated = [...lines];
    (updated[idx] as any)[field] = value;
    setLines(updated);
  };

  const handleSave = async () => {
    const validLines = lines.filter(l => l.paymentMode && Number(l.amount) > 0);
    if (validLines.length === 0) return;
    const payload = {
      settlementDate,
      remarks: remarks || undefined,
      lines: validLines.map(l => ({
        paymentMode: l.paymentMode,
        amount: Number(l.amount),
        referenceNote: l.referenceNote || undefined,
      })),
    } as any;
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
      } else {
        await createMut.mutateAsync({ data: payload });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/settlements'] });
      setIsModalOpen(false);
      setEditingId(null);
      resetForm();
    } catch (e: any) { toast({ title: 'Failed to save settlement', description: e.message, variant: 'destructive' }); }
  };

  const handleEdit = (s: any) => {
    setEditingId(s.id);
    setSettlementDate(s.settlementDate);
    setRemarks(s.remarks || '');
    const base = import.meta.env.BASE_URL || '/';
    const token = localStorage.getItem('token');
    fetch(`${base}api/settlements/${s.id}`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(detail => {
        if (detail.lines?.length) {
          setLines(detail.lines.map((l: any) => ({ paymentMode: l.paymentMode, amount: String(l.amount), referenceNote: l.referenceNote || '' })));
        }
        setIsModalOpen(true);
      });
  };

  const handleVerify = async (id: number) => {
    try {
      await verifyMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ['/api/settlements'] });
    } catch (e: any) { toast({ title: 'Failed to verify settlement', description: e.message, variant: 'destructive' }); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this settlement?')) return;
    try {
      await deleteMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ['/api/settlements'] });
    } catch (e: any) { toast({ title: 'Failed to delete settlement', description: e.message, variant: 'destructive' }); }
  };

  const resetForm = () => {
    setSettlementDate(new Date().toISOString().split('T')[0]);
    setRemarks('');
    setLines([
      { paymentMode: 'Cash', amount: '', referenceNote: '' },
      { paymentMode: 'Card', amount: '', referenceNote: '' },
      { paymentMode: 'QR', amount: '', referenceNote: '' },
    ]);
  };

  const matched = settlements?.filter(s => s.differenceType === 'matched').length || 0;
  const mismatched = settlements?.filter(s => s.differenceType !== 'matched').length || 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Daily Sales Settlement" description="Reconcile daily sales with payment collections">
        {!isViewer && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}><Plus size={18} /> New Settlement</Button>}
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Settlements" value={settlements?.length || 0} icon={Banknote} colorClass="text-primary" />
        <StatCard title="Matched" value={matched} icon={CheckCircle} colorClass="text-emerald-600" />
        <StatCard title="Mismatched" value={mismatched} icon={AlertTriangle} colorClass="text-amber-600" />
      </div>

      <DateFilter fromDate={filterFrom} toDate={filterTo} onChange={(f, t) => { setFilterFrom(f); setFilterTo(t); }} />

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4 text-right">Net Sales</th>
              <th className="px-6 py-4 text-right">Settlement</th>
              <th className="px-6 py-4 text-right">Difference</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : settlements?.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No settlements recorded.</td></tr>
            ) : settlements?.map(s => (
              <tr key={s.id} className="table-row-hover">
                <td className="px-6 py-4 font-medium">{formatDate(s.settlementDate)}</td>
                <td className="px-6 py-4 text-right">{formatCurrency(s.netSalesAmount)}</td>
                <td className="px-6 py-4 text-right">{formatCurrency(s.totalSettlementAmount)}</td>
                <td className={`px-6 py-4 text-right font-medium ${s.differenceType === 'matched' ? 'text-emerald-600' : s.differenceType === 'short' ? 'text-amber-600' : 'text-blue-600'}`}>
                  {formatCurrency(Math.abs(s.differenceAmount))}
                  {s.differenceType === 'short' && ' ▼'}
                  {s.differenceType === 'excess' && ' ▲'}
                </td>
                <td className="px-6 py-4"><StatusBadge type={s.differenceType} status={s.status} /></td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setDetailModal(s.id)} className="text-muted-foreground hover:text-primary"><Eye size={16} /></button>
                    {!isViewer && s.status !== 'verified' && (
                      <button onClick={() => handleEdit(s)} className="text-muted-foreground hover:text-primary"><Pencil size={16} /></button>
                    )}
                    {user?.role === 'admin' && s.status !== 'verified' && (
                      <button onClick={() => handleVerify(s.id)} className="text-muted-foreground hover:text-emerald-600"><ShieldCheck size={16} /></button>
                    )}
                    {user?.role === 'admin' && s.status !== 'verified' && (
                      <button onClick={() => handleDelete(s.id)} className="text-muted-foreground hover:text-red-500"><Trash2 size={16} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingId(null); }} title={editingId ? "Edit Settlement" : "New Daily Settlement"} maxWidth="max-w-2xl"
        footer={<><Button variant="ghost" onClick={() => { setIsModalOpen(false); setEditingId(null); }}>Cancel</Button><Button onClick={handleSave} disabled={(createMut.isPending || updateMut.isPending) || difference > 0.01}>{editingId ? 'Update' : 'Save'} Settlement</Button></>}>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <Label>Settlement Date</Label>
              <Input type="date" max={new Date().toISOString().split('T')[0]} value={settlementDate} onChange={(e: any) => setSettlementDate(e.target.value)} />
            </div>
            <div>
              <Label>Remarks</Label>
              <Input value={remarks} onChange={(e: any) => setRemarks(e.target.value)} placeholder="Optional notes" />
            </div>
          </div>

          {salesSummary && (
            <div className="grid grid-cols-3 gap-3 bg-muted/50 rounded-xl p-4">
              <div><p className="text-xs text-muted-foreground">Gross Sales</p><p className="font-semibold">{formatCurrency(salesSummary.grossSales)}</p></div>
              <div><p className="text-xs text-muted-foreground">Discount</p><p className="font-semibold">{formatCurrency(salesSummary.totalDiscount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Net Sales</p><p className="font-semibold text-primary">{formatCurrency(salesSummary.netSales)}</p></div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Payment Lines</Label>
              <Button variant="ghost" onClick={addLine} className="text-xs">+ Add Line</Button>
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select className="col-span-4 flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" value={line.paymentMode} onChange={(e) => updateLine(idx, 'paymentMode', e.target.value)}>
                    <option value="">Select...</option>
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <Input className="col-span-3" type="number" placeholder="Amount" value={line.amount} onChange={(e: any) => updateLine(idx, 'amount', e.target.value)} />
                  <Input className="col-span-4" placeholder="Reference" value={line.referenceNote} onChange={(e: any) => updateLine(idx, 'referenceNote', e.target.value)} />
                  <button className="col-span-1 text-muted-foreground hover:text-red-500" onClick={() => removeLine(idx)}><XCircle size={16} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className={`rounded-xl p-4 ${Math.abs(difference) < 0.01 ? 'bg-emerald-50 border border-emerald-200' : difference > 0.01 ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'}`}>
            <div className="grid grid-cols-3 gap-x-4 gap-y-5 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Net Sales</p>
                <p className="font-bold text-lg">{formatCurrency(netSales)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Settlement Total</p>
                <p className="font-bold text-lg">{formatCurrency(totalSettlement)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Difference</p>
                <p className={`font-bold text-lg ${Math.abs(difference) < 0.01 ? 'text-emerald-600' : difference > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                  {formatCurrency(Math.abs(difference))}
                  {difference > 0.01 ? ' Short' : difference < -0.01 ? ' Excess' : ' Matched'}
                </p>
              </div>
            </div>
            {difference > 0.01 && (
              <p className="text-xs text-red-600 text-center mt-2 font-medium">Settlement is short. Total must be equal to or greater than net sales to save.</p>
            )}
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!detailModal} onClose={() => setDetailModal(null)} title="Settlement Details" maxWidth="max-w-2xl">
        {detail && (
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 bg-muted/50 rounded-xl p-4">
              <div><p className="text-xs text-muted-foreground">Date</p><p className="font-medium">{formatDate(detail.settlement.settlementDate)}</p></div>
              <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge type={detail.settlement.differenceType} status={detail.settlement.status} /></div>
              <div><p className="text-xs text-muted-foreground">Net Sales</p><p className="font-medium">{formatCurrency(detail.settlement.netSalesAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Settlement Total</p><p className="font-medium">{formatCurrency(detail.settlement.totalSettlementAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Difference</p><p className={`font-medium ${detail.settlement.differenceType === 'matched' ? 'text-emerald-600' : 'text-amber-600'}`}>{formatCurrency(Math.abs(detail.settlement.differenceAmount))} {detail.settlement.differenceType !== 'matched' && `(${detail.settlement.differenceType})`}</p></div>
              {detail.settlement.remarks && <div><p className="text-xs text-muted-foreground">Remarks</p><p className="font-medium">{detail.settlement.remarks}</p></div>}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Payment Mode</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {detail.lines.map((l: any) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3 font-medium">{l.paymentMode}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(l.amount)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.referenceNote || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
