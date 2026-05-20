import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation } from 'wouter';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, formatDate, DateFilter, useFormDirty } from '../components/ui-extras';
import { ArrowLeft, Plus, Upload, ExternalLink, IndianRupee, AlertTriangle, FileText, CreditCard, BookOpen, BarChart3, Eye, Download } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';
import { getAuthToken } from '../lib/auth-storage';

const BASE = import.meta.env.BASE_URL || '/';
async function apiFetch(path: string, opts?: any) {
  const token = getAuthToken();
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
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const { toast } = useToast();

  const [detail, setDetail] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [tab, setTab] = useState<'overview' | 'bills' | 'payments' | 'ledger' | 'analytics'>('overview');
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ paymentDate: new Date().toISOString().split('T')[0], paymentMethod: 'cash', transactionReference: '', totalAmount: 0, remarks: '', allocations: [] as { purchaseId?: number; expenseId?: number; amount: number }[] });
  // Map keys are `${kind}-${id}` so purchase bills and expense bills can coexist.
  const [selectedBills, setSelectedBills] = useState<Map<string, number>>(new Map());
  // Map can't be JSON.stringified directly — convert to entries array.
  const paymentFormDirty = useFormDirty(paymentModal, { paymentForm, billsKey: Array.from(selectedBills.entries()) });
  const [billDetailOpen, setBillDetailOpen] = useState(false);
  const [billDetail, setBillDetail] = useState<{ purchase: any; lines: any[] } | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [downloadingBillId, setDownloadingBillId] = useState<number | null>(null);

  const openBillDetail = async (bill: any) => {
    setBillDetailOpen(true);
    setBillDetail(null);
    setBillLoading(true);
    try {
      const data = await apiFetch(`purchases/${bill.id}`);
      // Merge in financial fields from the bills row (paidAmount, pendingAmount,
      // dueDate) which the GET /api/purchases/:id endpoint omits.
      setBillDetail({
        purchase: { ...bill, ...data.purchase },
        lines: data.lines,
      });
    } catch (e: any) {
      toast({ title: 'Error loading bill', description: e.message, variant: 'destructive' });
      setBillDetailOpen(false);
    } finally {
      setBillLoading(false);
    }
  };

  const downloadBillPdf = async (billId: number, purchaseNumber: string) => {
    setDownloadingBillId(billId);
    try {
      const token = getAuthToken();
      const res = await fetch(`${BASE}api/purchases/${billId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text() || 'Failed to download PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeVendor = (detail?.vendor?.name || 'vendor').replace(/[^a-zA-Z0-9._-]/g, '_');
      a.download = `${purchaseNumber}_${safeVendor}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: 'Download failed', description: e.message, variant: 'destructive' });
    } finally {
      setDownloadingBillId(null);
    }
  };

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

  const toggleBillAllocation = (key: string, pending: number) => {
    const newMap = new Map(selectedBills);
    if (newMap.has(key)) { newMap.delete(key); } else { newMap.set(key, Math.round(pending * 100) / 100); }
    setSelectedBills(newMap);
    let total = 0;
    newMap.forEach(v => total += v);
    setPaymentForm(f => ({ ...f, totalAmount: Math.round(total * 100) / 100 }));
  };

  const updateBillAllocation = (key: string, amount: number) => {
    const newMap = new Map(selectedBills);
    newMap.set(key, amount);
    setSelectedBills(newMap);
    let total = 0;
    newMap.forEach(v => total += v);
    setPaymentForm(f => ({ ...f, totalAmount: Math.round(total * 100) / 100 }));
  };

  const handlePayment = async () => {
    try {
      // Bills are keyed by `${kind}-${id}` so a payment can mix purchase bills
      // and posted-to-portal expense bills in the same allocation set.
      const allocations = Array.from(selectedBills.entries()).map(([key, amount]) => {
        const [kind, idStr] = String(key).split('-');
        const id = Number(idStr);
        return kind === 'expense' ? { expenseId: id, amount } : { purchaseId: id, amount };
      });
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

      <div className="flex gap-1 bg-muted/60 rounded-xl p-1 w-fit">
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
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-transparent">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">PO / Invoice</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Date</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Due Date</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Amount</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Paid</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Pending</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Actions</th>
            </tr></thead>
            <tbody>{recentBills.map((b: any) => {
              const today = new Date().toISOString().split('T')[0];
              const isOverdue = b.dueDate && b.dueDate < today && b.pendingAmount > 0;
              const isExpense = b.kind === 'expense';
              const rowKey = `${b.kind || 'purchase'}-${b.id}`;
              return (
                <tr key={rowKey} className="border-b hover:bg-muted/30" data-testid={`row-bill-${rowKey}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{b.purchaseNumber}</span>
                      {isExpense && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700">Expense</span>}
                    </div>
                    {b.invoiceNumber && <div className="text-xs text-muted-foreground">{b.invoiceNumber}</div>}
                  </td>
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
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      {!isExpense && (
                        <>
                          <button
                            type="button"
                            onClick={() => openBillDetail(b)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="View bill details"
                            data-testid={`button-view-bill-${b.id}`}
                          >
                            <Eye size={13} /> View
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadBillPdf(b.id, b.purchaseNumber)}
                            disabled={downloadingBillId === b.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            title="Download bill as PDF"
                            data-testid={`button-download-bill-${b.id}`}
                          >
                            <Download size={13} className={downloadingBillId === b.id ? 'animate-pulse' : ''} />
                            {downloadingBillId === b.id ? '...' : 'PDF'}
                          </button>
                        </>
                      )}
                      {isExpense && (
                        <span className="text-[11px] text-muted-foreground">Posted from Expenses</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      {tab === 'payments' && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-transparent">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Payment No</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Date</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Method</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Amount</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Reference</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Proof</th>
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
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-transparent">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Date</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Type</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Description</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Debit</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Credit</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Balance</th>
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

      <Modal isOpen={paymentModal} onClose={() => setPaymentModal(false)} dirty={paymentFormDirty} title="Record Vendor Payment" maxWidth="max-w-lg"
        footer={(close) => <><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={handlePayment} disabled={paymentForm.totalAmount <= 0}>Save Payment</Button></>}>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
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
                {unpaidBills.map((b: any) => {
                  const key = `${b.kind || 'purchase'}-${b.id}`;
                  const isExpense = b.kind === 'expense';
                  return (
                    <div key={key} className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 hover:bg-muted/30">
                      <input
                        type="checkbox"
                        data-testid={`checkbox-allocate-${key}`}
                        checked={selectedBills.has(key)}
                        onChange={() => toggleBillAllocation(key, b.pendingAmount)}
                        className="rounded"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{b.purchaseNumber}</span>
                          {isExpense && <span className="px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700">Expense</span>}
                        </div>
                        <span className="text-xs text-muted-foreground">Pending: {formatCurrency(b.pendingAmount)}</span>
                      </div>
                      {selectedBills.has(key) && (
                        <Input
                          type="number"
                          step="0.01"
                          className="w-28"
                          value={selectedBills.get(key)}
                          onChange={e => updateBillAllocation(key, Math.min(Number(e.target.value), b.pendingAmount))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="p-4 bg-primary/10 rounded-xl border border-primary/20 flex justify-between items-center">
            <span className="font-semibold text-primary">Payment Total:</span>
            <span className="text-xl font-display font-bold text-primary">{formatCurrency(paymentForm.totalAmount)}</span>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={billDetailOpen}
        onClose={() => setBillDetailOpen(false)}
        title={billDetail?.purchase ? `Bill ${billDetail.purchase.purchaseNumber}` : 'Bill Details'}
        maxWidth="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBillDetailOpen(false)}>Close</Button>
            {billDetail?.purchase && (
              <Button
                onClick={() => downloadBillPdf(billDetail.purchase.id, billDetail.purchase.purchaseNumber)}
                disabled={downloadingBillId === billDetail.purchase.id}
                data-testid="button-download-bill-pdf"
              >
                <Download size={14} className="mr-1" />
                {downloadingBillId === billDetail.purchase.id ? 'Downloading…' : 'Download PDF'}
              </Button>
            )}
          </>
        }
      >
        {billLoading && (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading bill…</div>
        )}
        {!billLoading && billDetail && (() => {
          const p = billDetail.purchase;
          const lines = billDetail.lines || [];
          const subtotal = lines.reduce((s: number, l: any) => s + (Number(l.quantity || 0) * Number(l.unitRate || 0)), 0);
          const tax = lines.reduce((s: number, l: any) => s + (Number(l.quantity || 0) * Number(l.unitRate || 0)) * (Number(l.taxPercent || 0) / 100), 0);
          const total = subtotal + tax;
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Bill Date</p>
                  <p className="font-medium">{formatDate(p.purchaseDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vendor Invoice #</p>
                  <p className="font-medium">{p.invoiceNumber || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Mode</p>
                  <p className="font-medium capitalize">{(p.paymentMode || '—').toString().replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">{(p.paymentStatus || '—').toString().replace(/_/g, ' ')}</p>
                </div>
              </div>

              {detail?.vendor && (
                <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">Vendor</p>
                  <p className="font-semibold">{detail.vendor.name}</p>
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    {detail.vendor.contactPerson && <div>Contact: {detail.vendor.contactPerson}</div>}
                    {detail.vendor.mobile && <div>Mobile: {detail.vendor.mobile}</div>}
                    {detail.vendor.email && <div>Email: {detail.vendor.email}</div>}
                    {detail.vendor.address && <div>Address: {detail.vendor.address}</div>}
                    {detail.vendor.gstNumber && <div>GST: {detail.vendor.gstNumber}</div>}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wide w-8">#</th>
                      <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wide">Item</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wide">Qty</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wide">Rate</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wide">Tax %</th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wide">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No line items</td></tr>
                    ) : lines.map((l: any, i: number) => (
                      <tr key={l.id} className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.ingredientName || '—'}</div>
                          {l.purchaseUom && <div className="text-xs text-muted-foreground">{l.purchaseUom}</div>}
                        </td>
                        <td className="px-3 py-2 text-right font-numbers">{Number(l.quantity || 0)}</td>
                        <td className="px-3 py-2 text-right font-numbers">{formatCurrency(l.unitRate)}</td>
                        <td className="px-3 py-2 text-right font-numbers">{Number(l.taxPercent || 0)}%</td>
                        <td className="px-3 py-2 text-right font-numbers font-semibold">{formatCurrency(l.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <div className="w-full md:w-72 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-numbers">{formatCurrency(subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="font-numbers">{formatCurrency(tax)}</span></div>
                  <div className="flex justify-between border-t border-border pt-1.5"><span className="font-semibold text-primary">Grand Total</span><span className="font-numbers font-bold text-primary">{formatCurrency(total)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="font-numbers text-emerald-600">{formatCurrency(p.paidAmount ?? 0)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Pending</span><span className="font-numbers text-amber-600">{formatCurrency(p.pendingAmount ?? Math.max(total - (p.paidAmount ?? 0), 0))}</span></div>
                </div>
              </div>

              {(p.notes || p.remarks) && (
                <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">Remarks</p>
                  <p>{p.notes || p.remarks}</p>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
