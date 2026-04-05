import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation } from 'wouter';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, formatDate, DateFilter } from '../components/ui-extras';
import { ArrowLeft, Plus, Upload, ExternalLink, IndianRupee, AlertTriangle, FileText, CreditCard, BookOpen, BarChart3 } from 'lucide-react';
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

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'upi', 'cheque', 'card', 'petty_cash', 'adjustment'];

export default function VendorDetailPage() {
  const params = useParams<{ id: string }>();
  const vendorId = Number(params.id);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { toast } = useToast();

  const [detail, setDetail] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [tab, setTab] = useState<'overview' | 'bills' | 'payments' | 'ledger' | 'analytics'>('overview');
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ paymentDate: new Date().toISOString().split('T')[0], paymentMethod: 'cash', transactionReference: '', totalAmount: 0, remarks: '', allocations: [] as { purchaseId: number; amount: number }[] });
  const [selectedBills, setSelectedBills] = useState<Map<number, number>>(new Map());

  const loadDetail = useCallback(async () => {
    try { setLoadError(null); const data = await apiFetch(`vendor-detail/${vendorId}`); setDetail(data); }
    catch (e: any) { setLoadError(e.message || 'Failed to load vendor'); toast({ title: 'Error loading vendor', description: e.message, variant: 'destructive' }); }
  }, [vendorId]);

  const loadLedger = useCallback(async () => {
    try { const data = await apiFetch(`vendor-ledger/${vendorId}`); setLedger(data); }
    catch (e: any) { toast({ title: 'Error loading ledger', description: e.message, variant: 'destructive' }); }
  }, [vendorId]);

  useEffect(() => { loadDetail(); loadLedger(); }, [loadDetail, loadLedger]);

  const openPaymentModal = () => {
    setPaymentForm({ paymentDate: new Date().toISOString().split('T')[0], paymentMethod: 'cash', transactionReference: '', totalAmount: 0, remarks: '', allocations: [] });
    setSelectedBills(new Map());
    setPaymentModal(true);
  };

  const toggleBillAllocation = (billId: number, pending: number) => {
    const newMap = new Map(selectedBills);
    if (newMap.has(billId)) { newMap.delete(billId); } else { newMap.set(billId, Math.round(pending * 100) / 100); }
    setSelectedBills(newMap);
    let total = 0;
    newMap.forEach(v => total += v);
    setPaymentForm(f => ({ ...f, totalAmount: Math.round(total * 100) / 100 }));
  };

  const updateBillAllocation = (billId: number, amount: number) => {
    const newMap = new Map(selectedBills);
    newMap.set(billId, amount);
    setSelectedBills(newMap);
    let total = 0;
    newMap.forEach(v => total += v);
    setPaymentForm(f => ({ ...f, totalAmount: Math.round(total * 100) / 100 }));
  };

  const handlePayment = async () => {
    try {
      const allocations = Array.from(selectedBills.entries()).map(([purchaseId, amount]) => ({ purchaseId, amount }));
      await apiFetch('vendor-payments', {
        method: 'POST',
        body: JSON.stringify({ vendorId, ...paymentForm, allocations }),
      });
      toast({ title: 'Payment recorded' });
      setPaymentModal(false);
      loadDetail(); loadLedger();
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  if (loadError) return (
    <div className="p-8 text-center space-y-4">
      <p className="text-red-600 font-medium">Failed to load vendor</p>
      <p className="text-sm text-muted-foreground">{loadError}</p>
      <div className="flex gap-2 justify-center">
        <button onClick={() => setLocation('/vendors')} className="px-4 py-2 rounded-lg bg-muted text-sm hover:bg-muted/80">Back to Vendors</button>
        <button onClick={loadDetail} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Retry</button>
      </div>
    </div>
  );
  if (!detail) return <div className="p-8 text-center text-muted-foreground">Loading vendor details...</div>;

  const { vendor, summary, aging, recentBills, recentPayments } = detail;
  const unpaidBills = recentBills.filter((b: any) => b.pendingAmount > 0);

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: BarChart3 },
    { key: 'bills' as const, label: 'Bills', icon: FileText },
    { key: 'payments' as const, label: 'Payments', icon: CreditCard },
    { key: 'ledger' as const, label: 'Ledger', icon: BookOpen },
    { key: 'analytics' as const, label: 'Analytics', icon: BarChart3 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => setLocation('/vendors')} className="p-2 rounded-lg hover:bg-muted transition-colors"><ArrowLeft size={20} /></button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">{vendor.name}</h1>
          <p className="text-sm text-muted-foreground">{vendor.code} {vendor.contactPerson ? `• ${vendor.contactPerson}` : ''}</p>
        </div>
        <div className="ml-auto">
          <Button onClick={openPaymentModal}><Plus size={16} className="mr-1" /> Record Payment</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase">Total Purchase</p>
          <p className="text-xl font-bold font-numbers text-foreground">{formatCurrency(summary.totalPurchase)}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase">Total Paid</p>
          <p className="text-xl font-bold font-numbers text-emerald-600">{formatCurrency(summary.totalPaid)}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase">Pending</p>
          <p className="text-xl font-bold font-numbers text-amber-600">{formatCurrency(summary.totalPending)}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase">Overdue</p>
          <p className="text-xl font-bold font-numbers text-red-600">{formatCurrency(summary.overdueAmount)}</p>
          {summary.overdueBillsCount > 0 && <p className="text-xs text-red-500 mt-1">{summary.overdueBillsCount} bill(s)</p>}
        </div>
      </div>

      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card rounded-xl border p-5">
              <h3 className="font-semibold mb-3">Vendor Info</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Contact</span><span>{vendor.contactPerson || '-'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Mobile</span><span>{vendor.mobile || '-'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{vendor.email || '-'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span>{vendor.gstNumber || '-'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Credit Days</span><span>{vendor.creditDays || '-'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Payment Terms</span><span>{vendor.paymentTerms || '-'}</span></div>
              </div>
            </div>
            <div className="bg-card rounded-xl border p-5">
              <h3 className="font-semibold mb-3">Aging Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Current</span><span className="font-numbers">{formatCurrency(aging.current)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">1–7 Days</span><span className="font-numbers text-amber-500">{formatCurrency(aging.days1_7)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">8–15 Days</span><span className="font-numbers text-orange-500">{formatCurrency(aging.days8_15)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">16–30 Days</span><span className="font-numbers text-red-500">{formatCurrency(aging.days16_30)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">30+ Days</span><span className="font-numbers font-bold text-red-700">{formatCurrency(aging.days30plus)}</span></div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-muted/50 rounded-lg p-3"><p className="text-xs text-muted-foreground">Total Bills</p><p className="font-bold text-lg">{summary.totalBills}</p></div>
            <div className="bg-muted/50 rounded-lg p-3"><p className="text-xs text-muted-foreground">Overdue Bills</p><p className="font-bold text-lg text-red-600">{summary.overdueBillsCount}</p></div>
            <div className="bg-muted/50 rounded-lg p-3"><p className="text-xs text-muted-foreground">Last Purchase</p><p className="font-bold">{summary.lastPurchaseDate ? formatDate(summary.lastPurchaseDate) : '-'}</p></div>
            <div className="bg-muted/50 rounded-lg p-3"><p className="text-xs text-muted-foreground">Last Payment</p><p className="font-bold">{summary.lastPaymentDate ? formatDate(summary.lastPaymentDate) : '-'}</p></div>
          </div>
        </div>
      )}

      {tab === 'bills' && (
        <div className="bg-card rounded-xl border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">PO / Invoice</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Due Date</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Amount</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Paid</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Pending</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
            </tr></thead>
            <tbody>{recentBills.map((b: any) => {
              const today = new Date().toISOString().split('T')[0];
              const isOverdue = b.dueDate && b.dueDate < today && b.pendingAmount > 0;
              return (
                <tr key={b.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3"><div className="font-medium">{b.purchaseNumber}</div>{b.invoiceNumber && <div className="text-xs text-muted-foreground">{b.invoiceNumber}</div>}</td>
                  <td className="px-4 py-3">{formatDate(b.purchaseDate)}</td>
                  <td className="px-4 py-3">{b.dueDate ? formatDate(b.dueDate) : '-'}</td>
                  <td className="px-4 py-3 text-right font-numbers">{formatCurrency(b.totalAmount)}</td>
                  <td className="px-4 py-3 text-right font-numbers text-emerald-600">{formatCurrency(b.paidAmount)}</td>
                  <td className="px-4 py-3 text-right font-numbers text-amber-600">{formatCurrency(b.pendingAmount)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                      b.paymentStatus === 'fully_paid' ? 'bg-emerald-100 text-emerald-700' :
                      isOverdue ? 'bg-red-100 text-red-700' :
                      b.paymentStatus === 'partially_paid' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {isOverdue && <AlertTriangle size={11} />}
                      {isOverdue ? 'Overdue' : b.paymentStatus === 'fully_paid' ? 'Paid' : b.paymentStatus === 'partially_paid' ? 'Partial' : 'Unpaid'}
                    </span>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      {tab === 'payments' && (
        <div className="bg-card rounded-xl border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Payment No</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Method</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Reference</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Proof</th>
            </tr></thead>
            <tbody>{recentPayments.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No payments recorded yet</td></tr>
            ) : recentPayments.map((p: any) => (
              <tr key={p.id} className="border-b hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">{p.paymentNo}</td>
                <td className="px-4 py-3">{formatDate(p.paymentDate)}</td>
                <td className="px-4 py-3 capitalize">{p.paymentMethod.replace('_', ' ')}</td>
                <td className="px-4 py-3 text-right font-numbers font-semibold text-emerald-600">{formatCurrency(p.totalAmount)}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.transactionReference || '-'}</td>
                <td className="px-4 py-3 text-center">{p.paymentProof ? <span className="text-xs text-blue-600">Attached</span> : <span className="text-xs text-muted-foreground">-</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'ledger' && (
        <div className="bg-card rounded-xl border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Description</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Debit</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Credit</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Balance</th>
            </tr></thead>
            <tbody>{ledger.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No ledger entries</td></tr>
            ) : ledger.map((e: any) => (
              <tr key={e.id} className="border-b hover:bg-muted/30">
                <td className="px-4 py-3">{formatDate(e.transactionDate)}</td>
                <td className="px-4 py-3 capitalize">{e.transactionType}</td>
                <td className="px-4 py-3 text-muted-foreground">{e.description || '-'}</td>
                <td className="px-4 py-3 text-right font-numbers">{e.debit > 0 ? formatCurrency(e.debit) : '-'}</td>
                <td className="px-4 py-3 text-right font-numbers text-emerald-600">{e.credit > 0 ? formatCurrency(e.credit) : '-'}</td>
                <td className="px-4 py-3 text-right font-numbers font-semibold">{formatCurrency(e.runningBalance)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'analytics' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card rounded-xl border p-5">
            <h3 className="font-semibold mb-3">Purchase Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total Bills</span><span className="font-bold">{summary.totalBills}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Avg Bill Value</span><span className="font-numbers">{formatCurrency(summary.totalBills > 0 ? summary.totalPurchase / summary.totalBills : 0)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid %</span><span className="font-bold text-emerald-600">{summary.totalPurchase > 0 ? Math.round((summary.totalPaid / summary.totalPurchase) * 100) : 0}%</span></div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-5">
            <h3 className="font-semibold mb-3">Aging Breakdown</h3>
            <div className="space-y-2">
              {[
                { label: 'Current', val: aging.current, color: 'bg-emerald-500' },
                { label: '1–7 Days', val: aging.days1_7, color: 'bg-amber-400' },
                { label: '8–15 Days', val: aging.days8_15, color: 'bg-orange-400' },
                { label: '16–30 Days', val: aging.days16_30, color: 'bg-red-400' },
                { label: '30+ Days', val: aging.days30plus, color: 'bg-red-700' },
              ].map(a => {
                const pct = summary.totalPending > 0 ? (a.val / summary.totalPending) * 100 : 0;
                return (
                  <div key={a.label} className="flex items-center gap-3 text-sm">
                    <span className="w-20 text-muted-foreground">{a.label}</span>
                    <div className="flex-1 bg-muted rounded-full h-3"><div className={`${a.color} h-3 rounded-full`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                    <span className="w-24 text-right font-numbers">{formatCurrency(a.val)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={paymentModal} onClose={() => setPaymentModal(false)} title="Record Vendor Payment" maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setPaymentModal(false)}>Cancel</Button><Button onClick={handlePayment} disabled={paymentForm.totalAmount <= 0}>Save Payment</Button></>}>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Payment Date</Label><Input type="date" max={new Date().toISOString().split('T')[0]} value={paymentForm.paymentDate} onChange={e => setPaymentForm(f => ({ ...f, paymentDate: e.target.value }))} /></div>
            <div><Label>Payment Method</Label><Select value={paymentForm.paymentMethod} onChange={(e: any) => setPaymentForm(f => ({ ...f, paymentMethod: e.target.value }))}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ').toUpperCase()}</option>)}
            </Select></div>
          </div>
          <div><Label>Reference / UTR / Cheque No</Label><Input value={paymentForm.transactionReference} onChange={e => setPaymentForm(f => ({ ...f, transactionReference: e.target.value }))} /></div>
          <div><Label>Remarks</Label><Input value={paymentForm.remarks} onChange={e => setPaymentForm(f => ({ ...f, remarks: e.target.value }))} /></div>

          {unpaidBills.length > 0 && (
            <div>
              <Label>Allocate to Bills</Label>
              <div className="border rounded-lg mt-1 max-h-48 overflow-y-auto">
                {unpaidBills.map((b: any) => (
                  <div key={b.id} className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 hover:bg-muted/30">
                    <input type="checkbox" checked={selectedBills.has(b.id)} onChange={() => toggleBillAllocation(b.id, b.pendingAmount)} className="rounded" />
                    <div className="flex-1">
                      <span className="text-sm font-medium">{b.purchaseNumber}</span>
                      <span className="text-xs text-muted-foreground ml-2">Pending: {formatCurrency(b.pendingAmount)}</span>
                    </div>
                    {selectedBills.has(b.id) && (
                      <Input type="number" step="0.01" className="w-28" value={selectedBills.get(b.id)} onChange={e => updateBillAllocation(b.id, Math.min(Number(e.target.value), b.pendingAmount))} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex justify-between items-center">
            <span className="font-semibold text-primary">Payment Total:</span>
            <span className="text-xl font-display font-bold text-primary">{formatCurrency(paymentForm.totalAmount)}</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
