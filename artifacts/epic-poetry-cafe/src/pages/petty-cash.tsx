import React, { useState } from 'react';
import { useListPettyCash, useCreatePettyCash, useGetPettyCashSummary, useDeletePettyCash } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Modal, formatCurrency, formatDate, StatCard, DateFilter } from '../components/ui-extras';
import { Plus, Wallet, ArrowDownCircle, ArrowUpCircle, RefreshCw, Trash2, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';

const METHODS = ['Cash', 'Bank Withdrawal', 'UPI', 'Card Withdrawal', 'Owner Contribution', 'Manager Float'];
const CATEGORIES = ['Local Purchase', 'Cleaning Materials', 'Delivery Charges', 'Petty Maintenance', 'Staff Emergency', 'Small Repairs', 'Local Transport', 'Market Purchase', 'Tea/Snacks', 'Other'];

function TypeBadge({ type }: { type: string }) {
  if (type === 'receipt') return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 flex items-center gap-1"><ArrowDownCircle size={12} /> Receipt</span>;
  if (type === 'expense') return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 flex items-center gap-1"><ArrowUpCircle size={12} /> Expense</span>;
  return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 flex items-center gap-1"><RefreshCw size={12} /> Adjustment</span>;
}

export default function PettyCash() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const dateParams = { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  const { data: transactions, isLoading } = useListPettyCash(Object.keys(dateParams).length ? dateParams : undefined);
  const { data: summary } = useGetPettyCashSummary();
  const createMut = useCreatePettyCash();
  const deleteMut = useDeletePettyCash();
  const [editingId, setEditingId] = useState<number | null>(null);

  const [obModal, setObModal] = useState(false);
  const [obAmount, setObAmount] = useState('');
  const [obSaving, setObSaving] = useState(false);

  const handleSetOpeningBalance = async () => {
    const amt = Number(obAmount);
    if (isNaN(amt) || amt < 0) return;
    setObSaving(true);
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = localStorage.getItem('token');
      const res = await fetch(`${base}api/petty-cash/opening-balance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ amount: amt }),
      });
      if (!res.ok) throw new Error('Failed');
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash'] });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash/summary'] });
      setObModal(false);
    } catch (e) {
      alert('Failed to set opening balance');
    } finally {
      setObSaving(false);
    }
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    transactionDate: new Date().toISOString().split('T')[0],
    transactionType: 'receipt' as string,
    amount: '',
    method: 'Cash',
    counterpartyName: '',
    category: '',
    description: '',
  });

  const handleSave = async () => {
    const amt = Number(formData.amount);
    if (!amt || amt <= 0) return;
    const payload = {
      transactionDate: formData.transactionDate,
      transactionType: formData.transactionType as any,
      amount: amt,
      method: formData.method || undefined,
      counterpartyName: formData.counterpartyName || undefined,
      category: formData.category || undefined,
      description: formData.description || undefined,
    };
    try {
      if (editingId) {
        const base = import.meta.env.BASE_URL || '/';
        const token = localStorage.getItem('token');
        const res = await fetch(`${base}api/petty-cash/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed to update'); return; }
      } else {
        await createMut.mutateAsync({ data: payload });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash'] });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash/summary'] });
      setIsModalOpen(false);
      setEditingId(null);
      resetForm();
    } catch (e: any) {
      alert(e?.data?.error || e?.message || 'Error saving transaction');
    }
  };

  const resetForm = () => {
    setFormData({
      transactionDate: new Date().toISOString().split('T')[0],
      transactionType: 'receipt',
      amount: '',
      method: 'Cash',
      counterpartyName: '',
      category: '',
      description: '',
    });
  };

  const handleEditTxn = (t: any) => {
    setEditingId(t.id);
    setFormData({
      transactionDate: t.transactionDate,
      transactionType: t.transactionType,
      amount: String(t.amount),
      method: t.method || 'Cash',
      counterpartyName: t.counterpartyName || '',
      category: t.category || '',
      description: t.description || '',
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this transaction?')) return;
    try {
      await deleteMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash'] });
    } catch (e: any) { toast({ title: 'Failed to delete entry', description: e.message, variant: 'destructive' }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Petty Cash Ledger" description="Track petty cash receipts, expenses, and adjustments">
        {!isViewer && <Button onClick={() => { setEditingId(null); resetForm(); setIsModalOpen(true); }}><Plus size={18} /> New Entry</Button>}
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="relative">
          <StatCard title="Opening Balance" value={formatCurrency(summary?.openingBalance)} icon={Wallet} colorClass="text-slate-500" />
          {isAdmin && (
            <button
              onClick={() => { setObAmount(String(summary?.openingBalance || 0)); setObModal(true); }}
              className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Set Opening Balance"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
        <StatCard title="Total Receipts" value={formatCurrency(summary?.totalReceipts)} icon={ArrowDownCircle} colorClass="text-emerald-600" />
        <StatCard title="Total Expenses" value={formatCurrency(summary?.totalExpenses)} icon={ArrowUpCircle} colorClass="text-red-500" />
        <StatCard title="Adjustments" value={formatCurrency(summary?.totalAdjustments)} icon={RefreshCw} colorClass="text-blue-500" />
        <StatCard title="Current Balance" value={formatCurrency(summary?.currentBalance)} icon={Wallet} colorClass="text-primary" />
      </div>

      <DateFilter fromDate={fromDate} toDate={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t); }} />

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4 text-right">In</th>
              <th className="px-6 py-4 text-right">Out</th>
              <th className="px-6 py-4">Method</th>
              <th className="px-6 py-4">From/To</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4">Description</th>
              <th className="px-6 py-4 text-right">Balance</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={10} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : transactions?.length === 0 ? (
              <tr><td colSpan={10} className="px-6 py-8 text-center text-muted-foreground">No transactions recorded.</td></tr>
            ) : transactions?.map(t => (
              <tr key={t.id} className="table-row-hover">
                <td className="px-6 py-4 text-muted-foreground">{formatDate(t.transactionDate)}</td>
                <td className="px-6 py-4"><TypeBadge type={t.transactionType} /></td>
                <td className="px-6 py-4 text-right font-medium text-emerald-600">
                  {t.transactionType === 'receipt' ? formatCurrency(t.amount) : '-'}
                </td>
                <td className="px-6 py-4 text-right font-medium text-red-500">
                  {t.transactionType === 'expense' ? formatCurrency(t.amount) : '-'}
                </td>
                <td className="px-6 py-4">{t.method || '-'}</td>
                <td className="px-6 py-4">{t.counterpartyName || '-'}</td>
                <td className="px-6 py-4">{t.category || '-'}</td>
                <td className="px-6 py-4 text-muted-foreground max-w-[200px] truncate">{t.description || '-'}</td>
                <td className="px-6 py-4 text-right font-medium">{formatCurrency(t.runningBalance)}</td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {!isViewer && (
                      <button onClick={() => handleEditTxn(t)} className="text-muted-foreground hover:text-primary"><Pencil size={16} /></button>
                    )}
                    {isAdmin && (
                      <button onClick={() => handleDelete(t.id)} className="text-muted-foreground hover:text-red-500"><Trash2 size={16} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={obModal} onClose={() => setObModal(false)} title="Set Opening Balance"
        footer={<><Button variant="ghost" onClick={() => setObModal(false)}>Cancel</Button><Button onClick={handleSetOpeningBalance} disabled={obSaving}>{obSaving ? 'Saving...' : 'Save'}</Button></>}>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">Enter the cash amount that was already in the petty cash fund before you started tracking here. This will be added to all balance calculations.</p>
          <div>
            <Label>Opening Balance Amount (₹)</Label>
            <Input type="number" min="0" step="0.01" placeholder="0.00" value={obAmount} onChange={(e: any) => setObAmount(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingId(null); resetForm(); }} title={editingId ? "Edit Petty Cash Entry" : "New Petty Cash Entry"} maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => { setIsModalOpen(false); setEditingId(null); resetForm(); }}>Cancel</Button><Button onClick={handleSave} disabled={createMut.isPending}>{editingId ? 'Update' : 'Save'}</Button></>}>
        <div className="space-y-4 py-2">
          {summary && (
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground">Current Petty Cash Balance</p>
              <p className="text-lg font-bold text-primary">{formatCurrency(summary.currentBalance)}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Date</Label>
              <Input type="date" max={new Date().toISOString().split('T')[0]} value={formData.transactionDate} onChange={(e: any) => setFormData({ ...formData, transactionDate: e.target.value })} />
            </div>
            <div>
              <Label>Type</Label>
              <select className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" value={formData.transactionType} onChange={(e) => setFormData({ ...formData, transactionType: e.target.value })} disabled={!!editingId}>
                <option value="receipt">Receipt (In)</option>
                <option value="expense">Expense (Out)</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Amount</Label>
              <Input type="number" placeholder="0.00" value={formData.amount} onChange={(e: any) => setFormData({ ...formData, amount: e.target.value })} />
            </div>
            <div>
              <Label>Method</Label>
              <select className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" value={formData.method} onChange={(e) => setFormData({ ...formData, method: e.target.value })}>
                <option value="">Select...</option>
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{formData.transactionType === 'receipt' ? 'Received From' : 'Paid To'}</Label>
              <Input value={formData.counterpartyName} onChange={(e: any) => setFormData({ ...formData, counterpartyName: e.target.value })} placeholder="Name" />
            </div>
            {formData.transactionType !== 'receipt' && (
              <div>
                <Label>Category</Label>
                <select className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })}>
                  <option value="">Select...</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>

          <div>
            <Label>Description</Label>
            <Input value={formData.description} onChange={(e: any) => setFormData({ ...formData, description: e.target.value })} placeholder="Details" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
