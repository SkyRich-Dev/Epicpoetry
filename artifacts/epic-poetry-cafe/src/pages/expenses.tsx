import React, { useState, useEffect, useMemo } from 'react';
import { useListExpenses, useCreateExpense, useListVendors } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, formatDate, Badge, DateFilter, VerifyButton, apiVerify, apiUnverify, useFormDirty, useClientPagination, TablePagination } from '../components/ui-extras';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react/custom-fetch';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';
import { getAuthToken } from '../lib/auth-storage';

type ExpenseCostType = { id: number; code: string; label: string; description: string | null; isActive: boolean; sortOrder: number; isSystem: boolean };

type ExpenseFormState = {
  expenseDate: string;
  amount: number;
  costType: string;
  description: string;
  paymentMode: string;
  vendorId: number | null;
  postToVendorPortal: boolean;
  dueDate: string;
};

const blankExpenseForm = (): ExpenseFormState => ({
  expenseDate: new Date().toISOString().split('T')[0],
  amount: 0,
  costType: 'FIXED',
  description: '',
  paymentMode: 'CARD',
  vendorId: null,
  postToVendorPortal: false,
  dueDate: '',
});

export default function Expenses() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { hasPerm } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const canDelete = hasPerm('expenses.delete');
  const isViewer = user?.role === 'viewer';
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const dateParams = { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  const { data: expenses, isLoading } = useListExpenses(Object.keys(dateParams).length ? dateParams : undefined);
  const { data: vendors } = useListVendors();
  const { toast } = useToast();
  const createMut = useCreateExpense();

  // Cost types are now admin-managed master data instead of a hardcoded enum,
  // so the dropdown is whatever is currently active. We keep any expense's
  // legacy cost type code working in the badge fallback below.
  const [costTypes, setCostTypes] = useState<ExpenseCostType[]>([]);
  useEffect(() => {
    customFetch<ExpenseCostType[]>('/api/expense-cost-types')
      .then((rows) => setCostTypes(rows))
      .catch(() => setCostTypes([]));
  }, []);
  const costTypeByCode = useMemo(() => {
    const m = new Map<string, ExpenseCostType>();
    for (const r of costTypes) m.set(r.code, r);
    return m;
  }, [costTypes]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ExpenseFormState>(blankExpenseForm());
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; desc: string } | null>(null);
  const expensesPagination = useClientPagination(expenses || [], 10);

  const formDirty = useFormDirty(isModalOpen, formData);

  const defaultCostType = (): string => {
    if (costTypeByCode.has('FIXED')) return 'FIXED';
    return costTypes[0]?.code ?? 'FIXED';
  };

  const openCreate = () => {
    setEditId(null);
    setFormData({ ...blankExpenseForm(), costType: defaultCostType() });
    setIsModalOpen(true);
  };
  const openEdit = (e: any) => {
    setEditId(e.id);
    setFormData({
      expenseDate: e.expenseDate,
      amount: Number(e.amount),
      costType: e.costType || defaultCostType(),
      description: e.description || '',
      paymentMode: e.paymentMode || 'CARD',
      vendorId: e.vendorId ?? null,
      postToVendorPortal: !!e.postedToVendor,
      dueDate: e.dueDate || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (formData.amount <= 0) { toast({ title: 'Amount must be greater than 0', variant: 'destructive' }); return; }
    if (!formData.description.trim()) { toast({ title: 'Description is required', variant: 'destructive' }); return; }
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = getAuthToken();
      // The API treats vendorId as nullish — explicitly send null when cleared
      // so the backend can clear an existing link, and a number when picked.
      // Posting to vendor portal only makes sense when a vendor is selected.
      const postToVendorPortal = !!formData.postToVendorPortal && formData.vendorId != null;
      const payload: any = {
        expenseDate: formData.expenseDate,
        amount: formData.amount,
        costType: formData.costType,
        description: formData.description,
        // When posting to vendor portal the expense is on credit until paid via
        // Vendor Payments — petty cash should NOT be deducted now.
        paymentMode: postToVendorPortal ? 'CREDIT' : formData.paymentMode,
        vendorId: formData.vendorId ?? null,
        postToVendorPortal,
        dueDate: postToVendorPortal && formData.dueDate ? formData.dueDate : null,
      };
      if (editId) {
        const res = await fetch(`${base}api/expenses/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(await res.text());
      } else {
        // CreateExpenseBody requires vendorId to be omitted when not set, not null.
        const createPayload = { ...payload };
        if (createPayload.vendorId == null) delete createPayload.vendorId;
        await createMut.mutateAsync({ data: createPayload });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/expenses'] });
      setIsModalOpen(false);
      toast({ title: editId ? 'Expense updated' : 'Expense created' });
    } catch(e: any) { toast({ title: 'Failed to save expense', description: e.message, variant: 'destructive' }); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = getAuthToken();
      const res = await fetch(`${base}api/expenses/${deleteConfirm.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ['/api/expenses'] });
      setDeleteConfirm(null);
      toast({ title: 'Expense deleted' });
    } catch(e: any) { toast({ title: 'Failed to delete expense', description: e.message, variant: 'destructive' }); }
  };

  const handleVerify = async (id: number) => { await apiVerify('expenses', id); queryClient.invalidateQueries({ queryKey: ['/api/expenses'] }); };
  const handleUnverify = async (id: number) => { await apiUnverify('expenses', id); queryClient.invalidateQueries({ queryKey: ['/api/expenses'] }); };

  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" description="Manage operational costs, utilities, and generic expenses">
        {!isViewer && <Button onClick={openCreate}><Plus size={18}/> Log Expense</Button>}
      </PageHeader>

      <DateFilter fromDate={fromDate} toDate={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t); }} />

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Description</th>
              <th className="px-6 py-4">Vendor</th>
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4">Mode</th>
              <th className="px-6 py-4 text-right">Amount</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-center">Verified</th>
              {!isViewer && <th className="px-6 py-4 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">Loading expenses...</td></tr>
            ) : expenses?.length === 0 ? (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">No expenses recorded.</td></tr>
            ) : expensesPagination.paginatedRows.map((e: any) => (
              <tr key={e.id} className="table-row-hover" data-testid={`row-expense-${e.id}`}>
                <td className="px-6 py-4 text-muted-foreground">{formatDate(e.expenseDate)}</td>
                <td className="px-6 py-4 font-medium text-foreground">{e.description || 'Generic Expense'}</td>
                <td className="px-6 py-4 text-muted-foreground">{e.vendorName || <span className="opacity-50">—</span>}</td>
                <td className="px-6 py-4"><Badge variant="neutral">{costTypeByCode.get(e.costType)?.label ?? (e.costType === 'STAFF_FOOD' ? 'Staff Food' : e.costType === 'CLEANING' ? 'Cleaning' : e.costType)}</Badge></td>
                <td className="px-6 py-4 text-muted-foreground">{e.paymentMode}</td>
                <td className="px-6 py-4 text-right font-medium text-rose-600">{formatCurrency(e.amount)}</td>
                <td className="px-6 py-4 text-center" data-testid={`status-expense-${e.id}`}>
                  {e.postedToVendor ? (
                    e.vendorPaymentStatus === 'fully_paid'
                      ? <Badge variant="success">Paid</Badge>
                      : e.vendorPaymentStatus === 'partially_paid'
                        ? <Badge variant="warning">Partial</Badge>
                        : <Badge variant="warning">On vendor portal</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Settled</span>
                  )}
                </td>
                <td className="px-6 py-4 text-center"><VerifyButton verified={!!e.verified} isAdmin={isAdmin} onVerify={() => handleVerify(e.id)} onUnverify={() => handleUnverify(e.id)} /></td>
                {!isViewer && (
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(e)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Pencil size={14}/></button>
                      {canDelete && <button onClick={() => setDeleteConfirm({ id: e.id, desc: e.description || 'this expense' })} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 transition-colors" title="Delete"><Trash2 size={14}/></button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <TablePagination {...expensesPagination} onPageChange={expensesPagination.setPage} />
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} dirty={formDirty} title={editId ? "Edit Expense" : "Log Expense"} maxWidth="max-w-lg"
        footer={(close) => <><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={handleSave} disabled={createMut.isPending}>{editId ? 'Update' : 'Save'}</Button></>}>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Date</Label><Input type="date" max={new Date().toISOString().split('T')[0]} value={formData.expenseDate} onChange={(e:any) => setFormData({...formData, expenseDate: e.target.value})} /></div>
            <div>
              <Label>Cost Type</Label>
              <Select data-testid="select-expense-cost-type" value={formData.costType} onChange={(e:any) => setFormData({...formData, costType: e.target.value})}>
                {/* Render whatever the API has, plus the current value if it's somehow no longer active so editing legacy rows still works. */}
                {costTypes.map((t) => (
                  <option key={t.code} value={t.code}>{t.label}</option>
                ))}
                {formData.costType && !costTypeByCode.has(formData.costType) && (
                  <option value={formData.costType}>{formData.costType} (inactive)</option>
                )}
              </Select>
            </div>
          </div>
          <div><Label>Description</Label><Input value={formData.description} onChange={(e:any) => setFormData({...formData, description: e.target.value})} placeholder="e.g. Plumber repair" /></div>
          <div>
            <Label>Vendor (optional)</Label>
            <Select
              data-testid="select-expense-vendor"
              value={formData.vendorId == null ? '' : String(formData.vendorId)}
              onChange={(e: any) => setFormData({ ...formData, vendorId: e.target.value === '' ? null : Number(e.target.value), postToVendorPortal: e.target.value === '' ? false : formData.postToVendorPortal })}
            >
              <option value="">— No vendor —</option>
              {vendors?.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">Pick a food / pest control / maintenance vendor to track their bills.</p>
          </div>

          {formData.vendorId != null && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20 p-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  data-testid="checkbox-post-to-vendor"
                  checked={formData.postToVendorPortal}
                  onChange={(e: any) => setFormData({ ...formData, postToVendorPortal: e.target.checked })}
                />
                <div className="text-sm">
                  <div className="font-medium text-foreground">Post to vendor portal</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Track this as a vendor bill instead of an immediate payment. It will appear in the vendor's outstanding balance and ledger, and you can pay it later via Vendor Payments.
                  </div>
                </div>
              </label>
              {formData.postToVendorPortal && (
                <div className="mt-3">
                  <Label>Due Date (optional)</Label>
                  <Input
                    type="date"
                    data-testid="input-expense-due-date"
                    value={formData.dueDate}
                    onChange={(e: any) => setFormData({ ...formData, dueDate: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Amount</Label><Input type="number" step="0.01" value={formData.amount} onChange={(e:any) => setFormData({...formData, amount: Number(e.target.value)})} /></div>
            <div>
              <Label>Payment Mode</Label>
              {formData.postToVendorPortal ? (
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="payment-mode-credit">
                  On credit (vendor portal)
                </div>
              ) : (
                <Select value={formData.paymentMode} onChange={(e:any) => setFormData({...formData, paymentMode: e.target.value})}>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="PETTY_CASH">Petty Cash</option>
                </Select>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Expense"
        footer={(close) => <><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}>
        <p className="py-2 text-sm text-muted-foreground">Are you sure you want to delete <span className="font-semibold text-foreground">{deleteConfirm?.desc}</span>?</p>
      </Modal>
    </div>
  );
}
