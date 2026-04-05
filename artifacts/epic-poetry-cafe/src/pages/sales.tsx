import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useListMenuItems } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, formatDate, DateFilter, VerifyButton } from '../components/ui-extras';
import { Plus, Trash2, Eye, FileText, BarChart3, Package, CheckCircle2, AlertTriangle, X, TrendingUp, IndianRupee, ArrowRight } from 'lucide-react';
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

const ORDER_TYPES = ['dine-in', 'takeaway', 'delivery', 'online'];
const PAYMENT_MODES = ['cash', 'card', 'upi', 'wallet', 'mixed'];

export default function Sales() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const { toast } = useToast();
  const { data: menuItems } = useListMenuItems({ active: true });

  const [tab, setTab] = useState<'invoices' | 'items' | 'daily' | 'consumption'>('invoices');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [invoices, setInvoices] = useState<any[]>([]);
  const [itemSummary, setItemSummary] = useState<any[]>([]);
  const [dailySummary, setDailySummary] = useState<any[]>([]);
  const [consumption, setConsumption] = useState<any[]>([]);
  const [invLoading, setInvLoading] = useState(false);

  const [invoiceModal, setInvoiceModal] = useState(false);
  const [detailModal, setDetailModal] = useState<any>(null);
  const [deleteConfirmInv, setDeleteConfirmInv] = useState<any>(null);
  const [invoiceForm, setInvoiceForm] = useState({
    salesDate: new Date().toISOString().split('T')[0], invoiceNo: '', invoiceTime: '',
    orderType: 'dine-in', customerName: '', totalDiscount: 0, paymentMode: 'cash',
    paymentReference: '', gstInclusive: true,
    lines: [{ menuItemId: 0, quantity: 1, gstPercent: 5 }] as { menuItemId: number; quantity: number; gstPercent: number }[],
  });

  const getMenuPrice = (id: number) => menuItems?.find(m => m.id === id)?.sellingPrice || 0;

  const buildParams = () => {
    const p = new URLSearchParams();
    if (fromDate) p.set('fromDate', fromDate);
    if (toDate) p.set('toDate', toDate);
    return p.toString();
  };

  const loadInvoices = useCallback(async () => {
    setInvLoading(true);
    try { const data = await apiFetch(`sales-invoices?${buildParams()}`); setInvoices(data); } catch {} finally { setInvLoading(false); }
  }, [fromDate, toDate]);

  const loadItemSummary = useCallback(async () => {
    try { const data = await apiFetch(`sales-invoices-item-summary?${buildParams()}`); setItemSummary(data); } catch {}
  }, [fromDate, toDate]);

  const loadDailySummary = useCallback(async () => {
    try { const data = await apiFetch(`sales-invoices-daily-summary?${buildParams()}`); setDailySummary(data); } catch {}
  }, [fromDate, toDate]);

  const loadConsumption = useCallback(async () => {
    try { const data = await apiFetch(`sales-invoices-consumption?${buildParams()}`); setConsumption(data); } catch {}
  }, [fromDate, toDate]);

  useEffect(() => {
    if (tab === 'invoices') loadInvoices();
    else if (tab === 'items') loadItemSummary();
    else if (tab === 'daily') loadDailySummary();
    else if (tab === 'consumption') loadConsumption();
  }, [tab, fromDate, toDate]);

  useEffect(() => {
    loadInvoices();
  }, [fromDate, toDate]);

  const openInvoiceCreate = () => {
    setInvoiceForm({
      salesDate: new Date().toISOString().split('T')[0], invoiceNo: '', invoiceTime: '',
      orderType: 'dine-in', customerName: '', totalDiscount: 0, paymentMode: 'cash',
      paymentReference: '', gstInclusive: true,
      lines: [{ menuItemId: 0, quantity: 1, gstPercent: 5 }],
    });
    setInvoiceModal(true);
  };

  const addLine = () => setInvoiceForm(f => ({ ...f, lines: [...f.lines, { menuItemId: 0, quantity: 1, gstPercent: 5 }] }));
  const removeLine = (idx: number) => setInvoiceForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  const updateLine = (idx: number, field: string, value: any) => {
    setInvoiceForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) }));
  };

  const calcLineGross = () => invoiceForm.lines.reduce((sum, l) => sum + l.quantity * getMenuPrice(l.menuItemId), 0);
  const grossTotal = calcLineGross();
  const netTotal = grossTotal - invoiceForm.totalDiscount;

  const handleInvoiceCreate = async () => {
    try {
      const validLines = invoiceForm.lines.filter(l => l.menuItemId > 0 && l.quantity > 0);
      if (validLines.length === 0) { toast({ title: 'Add at least one item', variant: 'destructive' }); return; }
      await apiFetch('sales-invoices', {
        method: 'POST',
        body: JSON.stringify({ ...invoiceForm, lines: validLines.map(l => ({ menuItemId: l.menuItemId, quantity: l.quantity, gstPercent: l.gstPercent })) }),
      });
      toast({ title: 'Invoice created' });
      setInvoiceModal(false);
      loadInvoices();
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const viewInvoiceDetail = async (id: number) => {
    try { const data = await apiFetch(`sales-invoices/${id}`); setDetailModal(data); } catch {}
  };

  const handleVerifyInv = async (id: number) => {
    try { await apiFetch(`sales-invoices/${id}/verify`, { method: 'PATCH' }); toast({ title: 'Verified' }); loadInvoices(); } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };
  const handleUnverifyInv = async (id: number) => {
    try { await apiFetch(`sales-invoices/${id}/unverify`, { method: 'PATCH' }); toast({ title: 'Unverified' }); loadInvoices(); } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const handleInvDelete = async () => {
    if (!deleteConfirmInv) return;
    try { await apiFetch(`sales-invoices/${deleteConfirmInv.id}`, { method: 'DELETE' }); toast({ title: 'Deleted' }); setDeleteConfirmInv(null); loadInvoices(); } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const invStats = useMemo(() => invoices.reduce((acc, inv) => ({
    count: acc.count + 1, gross: acc.gross + inv.grossAmount, discount: acc.discount + inv.totalDiscount,
    gst: acc.gst + inv.gstAmount, final: acc.final + inv.finalAmount, mismatched: acc.mismatched + (inv.matchStatus === 'mismatched' ? 1 : 0),
  }), { count: 0, gross: 0, discount: 0, gst: 0, final: 0, mismatched: 0 }), [invoices]);

  const drillToDate = (date: string) => {
    setFromDate(date);
    setToDate(date);
    setTab('invoices');
  };

  const tabs = [
    { key: 'invoices' as const, label: 'Invoices', icon: FileText },
    { key: 'items' as const, label: 'Item Summary', icon: Package },
    { key: 'daily' as const, label: 'Daily Summary', icon: BarChart3 },
    { key: 'consumption' as const, label: 'Consumption', icon: Package },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Sales" description="Sales invoices with GST, item analytics, and consumption tracking">
        {!isViewer && tab === 'invoices' && <Button onClick={openInvoiceCreate}><Plus size={18}/> New Invoice</Button>}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border p-4 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setTab('invoices')}>
          <p className="text-xs text-muted-foreground uppercase flex items-center gap-1"><TrendingUp size={12} /> Total Sales</p>
          <p className="text-2xl font-bold font-numbers text-emerald-600">{formatCurrency(invStats.final)}</p>
          <p className="text-xs text-muted-foreground mt-1">{invStats.count} invoices</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase flex items-center gap-1"><FileText size={12} /> Gross Sales</p>
          <p className="text-xl font-bold font-numbers">{formatCurrency(invStats.gross)}</p>
          <p className="text-xs text-muted-foreground mt-1">Before discounts & GST</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase flex items-center gap-1"><IndianRupee size={12} /> GST Collected</p>
          <p className="text-xl font-bold font-numbers text-blue-600">{formatCurrency(invStats.gst)}</p>
          <p className="text-xs text-muted-foreground mt-1">Discount: {formatCurrency(invStats.discount)}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase flex items-center gap-1"><AlertTriangle size={12} /> Mismatches</p>
          <p className="text-xl font-bold font-numbers text-red-600">{invStats.mismatched}</p>
          <p className="text-xs text-muted-foreground mt-1">{invStats.mismatched > 0 ? 'Needs attention' : 'All matched'}</p>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex gap-1 bg-muted/60 rounded-xl p-1 flex-wrap">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </div>
        <DateFilter fromDate={fromDate} toDate={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t); }} />
      </div>

      {tab === 'invoices' && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-transparent">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Invoice</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Date</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Type</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Gross</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Disc</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">GST</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Final</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Match</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Payment</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Verified</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Actions</th>
            </tr></thead>
            <tbody>
              {invLoading ? (
                <tr><td colSpan={11} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={11} className="px-6 py-8 text-center text-muted-foreground">No invoices found</td></tr>
              ) : invoices.map(inv => (
                <tr key={inv.id} className="border-b border-border/50 hover:bg-muted/30 transition-all duration-150">
                  <td className="px-4 py-3"><div className="font-medium">{inv.invoiceNo}</div><div className="text-xs text-muted-foreground capitalize">{inv.sourceType}</div></td>
                  <td className="px-4 py-3">{formatDate(inv.salesDate)}{inv.invoiceTime && <div className="text-xs text-muted-foreground">{inv.invoiceTime}</div>}</td>
                  <td className="px-4 py-3 capitalize">{inv.orderType}</td>
                  <td className="px-4 py-3 text-right font-numbers">{formatCurrency(inv.grossAmount)}</td>
                  <td className="px-4 py-3 text-right font-numbers text-orange-600">{inv.totalDiscount > 0 ? formatCurrency(inv.totalDiscount) : '-'}</td>
                  <td className="px-4 py-3 text-right font-numbers text-blue-600">{inv.gstAmount > 0 ? formatCurrency(inv.gstAmount) : '-'}</td>
                  <td className="px-4 py-3 text-right font-numbers font-semibold text-emerald-600">{formatCurrency(inv.finalAmount)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${inv.matchStatus === 'matched' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {inv.matchStatus === 'matched' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                      {inv.matchStatus === 'matched' ? 'OK' : `${formatCurrency(inv.matchDifference)}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center capitalize text-xs">{inv.paymentMode}</td>
                  <td className="px-4 py-3 text-center"><VerifyButton verified={!!inv.verified} isAdmin={isAdmin} onVerify={() => handleVerifyInv(inv.id)} onUnverify={() => handleUnverifyInv(inv.id)} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => viewInvoiceDetail(inv.id)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="View"><Eye size={14}/></button>
                      {isAdmin && <button onClick={() => setDeleteConfirmInv(inv)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 transition-colors" title="Delete"><Trash2 size={14}/></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'items' && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-transparent">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Item</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Qty Sold</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Menu Price</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Gross</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Discount</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">GST</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Final</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Avg Realized</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Invoices</th>
            </tr></thead>
            <tbody>
              {itemSummary.length === 0 ? (
                <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">No data</td></tr>
              ) : itemSummary.map((item: any) => (
                <tr key={item.menuItemId} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3"><div className="font-medium">{item.itemName}</div><div className="text-xs text-muted-foreground">{item.itemCode}</div></td>
                  <td className="px-4 py-3 text-right font-numbers">{item.totalQty}</td>
                  <td className="px-4 py-3 text-right font-numbers">{formatCurrency(item.fixedPrice)}</td>
                  <td className="px-4 py-3 text-right font-numbers">{formatCurrency(item.totalGross)}</td>
                  <td className="px-4 py-3 text-right font-numbers text-orange-600">{item.totalDiscount > 0 ? formatCurrency(item.totalDiscount) : '-'}</td>
                  <td className="px-4 py-3 text-right font-numbers text-blue-600">{item.totalGst > 0 ? formatCurrency(item.totalGst) : '-'}</td>
                  <td className="px-4 py-3 text-right font-numbers font-semibold text-emerald-600">{formatCurrency(item.totalFinal)}</td>
                  <td className="px-4 py-3 text-right font-numbers">{formatCurrency(item.avgRealizedPrice)}</td>
                  <td className="px-4 py-3 text-right font-numbers">{item.invoiceCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'daily' && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-transparent">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Date</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Invoices</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Gross</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Discount</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">GST</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Net Sales</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Mismatches</th>
            </tr></thead>
            <tbody>
              {dailySummary.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No data</td></tr>
              ) : dailySummary.map((day: any) => (
                <tr key={day.date} className="border-b hover:bg-muted/30 cursor-pointer group" onClick={() => drillToDate(day.date)} title="Click to view invoices for this date">
                  <td className="px-4 py-3 font-medium text-primary group-hover:underline flex items-center gap-1">{formatDate(day.date)} <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" /></td>
                  <td className="px-4 py-3 text-right font-numbers">{day.totalInvoices}</td>
                  <td className="px-4 py-3 text-right font-numbers">{formatCurrency(day.totalGross)}</td>
                  <td className="px-4 py-3 text-right font-numbers text-orange-600">{day.totalDiscount > 0 ? formatCurrency(day.totalDiscount) : '-'}</td>
                  <td className="px-4 py-3 text-right font-numbers text-blue-600">{day.totalGst > 0 ? formatCurrency(day.totalGst) : '-'}</td>
                  <td className="px-4 py-3 text-right font-numbers font-semibold text-emerald-600">{formatCurrency(day.totalFinal)}</td>
                  <td className="px-4 py-3 text-center">{day.mismatchCount > 0 ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700"><AlertTriangle size={11} /> {day.mismatchCount}</span> : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'consumption' && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-transparent">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Ingredient</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Required Qty</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">UOM</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Rate (Last)</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Est. Cost</th>
            </tr></thead>
            <tbody>
              {consumption.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No consumption data</td></tr>
              ) : consumption.map((c: any) => (
                <tr key={c.ingredientId} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{c.ingredientName}</td>
                  <td className="px-4 py-3 text-right font-numbers">{c.totalQty}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.uom}</td>
                  <td className="px-4 py-3 text-right font-numbers text-muted-foreground">{c.lastPrice > 0 ? formatCurrency(c.lastPrice) : '-'}</td>
                  <td className="px-4 py-3 text-right font-numbers font-semibold text-orange-600">{c.estimatedCost > 0 ? formatCurrency(c.estimatedCost) : '-'}</td>
                </tr>
              ))}
              {consumption.length > 0 && (
                <tr className="border-t-2 bg-transparent">
                  <td colSpan={4} className="px-4 py-3 font-semibold text-right">Total Estimated Material Cost</td>
                  <td className="px-4 py-3 text-right font-numbers font-bold text-orange-600">{formatCurrency(consumption.reduce((sum: number, c: any) => sum + (c.estimatedCost || 0), 0))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={invoiceModal} onClose={() => setInvoiceModal(false)} title="New Sales Invoice" maxWidth="max-w-2xl"
        footer={<><Button variant="ghost" onClick={() => setInvoiceModal(false)}>Cancel</Button><Button onClick={handleInvoiceCreate}>Create Invoice</Button></>}>
        <div className="space-y-5 py-2 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-3 gap-x-4 gap-y-5">
            <div><Label>Date</Label><Input type="date" max={new Date().toISOString().split('T')[0]} value={invoiceForm.salesDate} onChange={e => setInvoiceForm(f => ({ ...f, salesDate: e.target.value }))} /></div>
            <div><Label>Invoice No (optional)</Label><Input value={invoiceForm.invoiceNo} onChange={e => setInvoiceForm(f => ({ ...f, invoiceNo: e.target.value }))} placeholder="Auto-generated" /></div>
            <div><Label>Time</Label><Input type="time" value={invoiceForm.invoiceTime} onChange={e => setInvoiceForm(f => ({ ...f, invoiceTime: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-5">
            <div><Label>Order Type</Label><Select value={invoiceForm.orderType} onChange={(e: any) => setInvoiceForm(f => ({ ...f, orderType: e.target.value }))}>{ORDER_TYPES.map(t => <option key={t} value={t}>{t.replace('-', ' ').toUpperCase()}</option>)}</Select></div>
            <div><Label>Payment Mode</Label><Select value={invoiceForm.paymentMode} onChange={(e: any) => setInvoiceForm(f => ({ ...f, paymentMode: e.target.value }))}>{PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}</Select></div>
            <div><Label>Customer Name</Label><Input value={invoiceForm.customerName} onChange={e => setInvoiceForm(f => ({ ...f, customerName: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Total Discount</Label><Input type="number" step="0.01" min="0" value={invoiceForm.totalDiscount} onChange={e => setInvoiceForm(f => ({ ...f, totalDiscount: Number(e.target.value) }))} /></div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={invoiceForm.gstInclusive} onChange={e => setInvoiceForm(f => ({ ...f, gstInclusive: e.target.checked }))} className="rounded" />
                GST Inclusive
              </label>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Line Items</Label>
              <button onClick={addLine} className="text-xs text-primary hover:underline">+ Add Item</button>
            </div>
            <div className="space-y-2">
              {invoiceForm.lines.map((line, idx) => (
                <div key={idx} className="flex gap-2 items-end">
                  <div className="flex-1">
                    {idx === 0 && <span className="text-xs text-muted-foreground">Item</span>}
                    <Select value={line.menuItemId} onChange={(e: any) => updateLine(idx, 'menuItemId', Number(e.target.value))}>
                      <option value={0}>Select...</option>
                      {menuItems?.map(m => <option key={m.id} value={m.id}>{m.name} ({formatCurrency(m.sellingPrice)})</option>)}
                    </Select>
                  </div>
                  <div className="w-20">
                    {idx === 0 && <span className="text-xs text-muted-foreground">Qty</span>}
                    <Input type="number" min="1" value={line.quantity} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} />
                  </div>
                  <div className="w-20">
                    {idx === 0 && <span className="text-xs text-muted-foreground">GST %</span>}
                    <Input type="number" min="0" step="0.5" value={line.gstPercent} onChange={e => updateLine(idx, 'gstPercent', Number(e.target.value))} />
                  </div>
                  <div className="w-24 text-right font-numbers text-sm pt-1">
                    {idx === 0 && <span className="text-xs text-muted-foreground block">Line Total</span>}
                    {formatCurrency(line.quantity * getMenuPrice(line.menuItemId))}
                  </div>
                  {invoiceForm.lines.length > 1 && (
                    <button onClick={() => removeLine(idx)} className="p-1.5 text-muted-foreground hover:text-red-500"><X size={14} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="p-4 bg-primary/10 rounded-xl border border-primary/20 space-y-1">
            <div className="flex justify-between text-sm"><span>Gross Total:</span><span className="font-numbers">{formatCurrency(grossTotal)}</span></div>
            <div className="flex justify-between text-sm text-orange-600"><span>Discount:</span><span className="font-numbers">-{formatCurrency(invoiceForm.totalDiscount)}</span></div>
            <div className="flex justify-between font-semibold text-primary text-lg border-t pt-1 mt-1"><span>Net Total:</span><span className="font-numbers">{formatCurrency(netTotal)}</span></div>
          </div>
        </div>
      </Modal>

      {detailModal && (
        <Modal isOpen={!!detailModal} onClose={() => setDetailModal(null)} title={`Invoice ${detailModal.invoiceNo}`} maxWidth="max-w-2xl">
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-3 gap-x-4 gap-y-5 text-sm">
              <div><span className="text-muted-foreground">Date:</span> {formatDate(detailModal.salesDate)}</div>
              <div><span className="text-muted-foreground">Type:</span> <span className="capitalize">{detailModal.orderType}</span></div>
              <div><span className="text-muted-foreground">Payment:</span> <span className="capitalize">{detailModal.paymentMode}</span></div>
              {detailModal.customerName && <div><span className="text-muted-foreground">Customer:</span> {detailModal.customerName}</div>}
              <div><span className="text-muted-foreground">Source:</span> <span className="capitalize">{detailModal.sourceType}</span></div>
              <div><span className="text-muted-foreground">Match:</span> <span className={detailModal.matchStatus === 'matched' ? 'text-emerald-600' : 'text-red-600'}>{detailModal.matchStatus}</span></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-transparent">
                  <th className="px-3 py-2 text-left text-xs">Item</th>
                  <th className="px-3 py-2 text-right text-xs">Qty</th>
                  <th className="px-3 py-2 text-right text-xs">Price</th>
                  <th className="px-3 py-2 text-right text-xs">Gross</th>
                  <th className="px-3 py-2 text-right text-xs">Disc</th>
                  <th className="px-3 py-2 text-right text-xs">GST</th>
                  <th className="px-3 py-2 text-right text-xs">Final</th>
                </tr></thead>
                <tbody>
                  {detailModal.lines?.map((l: any) => (
                    <tr key={l.id} className="border-b">
                      <td className="px-3 py-2 font-medium">{l.itemNameSnapshot || l.menuItemName}</td>
                      <td className="px-3 py-2 text-right font-numbers">{l.quantity}</td>
                      <td className="px-3 py-2 text-right font-numbers">{formatCurrency(l.fixedPrice)}</td>
                      <td className="px-3 py-2 text-right font-numbers">{formatCurrency(l.grossLineAmount)}</td>
                      <td className="px-3 py-2 text-right font-numbers text-orange-600">{l.lineDiscountAmount > 0 ? formatCurrency(l.lineDiscountAmount) : '-'}</td>
                      <td className="px-3 py-2 text-right font-numbers text-blue-600">{l.gstAmount > 0 ? `${formatCurrency(l.gstAmount)} (${l.gstPercent}%)` : '-'}</td>
                      <td className="px-3 py-2 text-right font-numbers font-semibold">{formatCurrency(l.finalLineAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg space-y-1 text-sm">
              <div className="flex justify-between"><span>Gross:</span><span className="font-numbers">{formatCurrency(detailModal.grossAmount)}</span></div>
              <div className="flex justify-between text-orange-600"><span>Discount:</span><span className="font-numbers">-{formatCurrency(detailModal.totalDiscount)}</span></div>
              <div className="flex justify-between"><span>Taxable:</span><span className="font-numbers">{formatCurrency(detailModal.taxableAmount)}</span></div>
              <div className="flex justify-between text-blue-600"><span>GST:</span><span className="font-numbers">{formatCurrency(detailModal.gstAmount)}</span></div>
              <div className="flex justify-between font-bold text-emerald-600 border-t pt-1 mt-1"><span>Final Amount:</span><span className="font-numbers">{formatCurrency(detailModal.finalAmount)}</span></div>
            </div>
          </div>
        </Modal>
      )}

      <Modal isOpen={!!deleteConfirmInv} onClose={() => setDeleteConfirmInv(null)} title="Delete Invoice"
        footer={<><Button variant="ghost" onClick={() => setDeleteConfirmInv(null)}>Cancel</Button><Button variant="danger" onClick={handleInvDelete}>Delete</Button></>}>
        <p className="py-2 text-sm text-muted-foreground">Delete invoice <span className="font-semibold text-foreground">{deleteConfirmInv?.invoiceNo}</span>? This removes all line items.</p>
      </Modal>
    </div>
  );
}
