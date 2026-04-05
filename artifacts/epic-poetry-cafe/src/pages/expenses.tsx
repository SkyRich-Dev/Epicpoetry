import React, { useState } from 'react';
import { useListExpenses, useCreateExpense } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, formatDate, Badge, DateFilter, VerifyButton, apiVerify, apiUnverify } from '../components/ui-extras';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';

export default function Expenses() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const dateParams = { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  const { data: expenses, isLoading } = useListExpenses(Object.keys(dateParams).length ? dateParams : undefined);
  const { toast } = useToast();
  const createMut = useCreateExpense();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ expenseDate: new Date().toISOString().split('T')[0], amount: 0, costType: 'FIXED', description: '', paymentMode: 'CARD' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; desc: string } | null>(null);

  const openCreate = () => { setEditId(null); setFormData({ expenseDate: new Date().toISOString().split('T')[0], amount: 0, costType: 'FIXED', description: '', paymentMode: 'CARD' }); setIsModalOpen(true); };
  const openEdit = (e: any) => { setEditId(e.id); setFormData({ expenseDate: e.expenseDate, amount: Number(e.amount), costType: e.costType || 'FIXED', description: e.description || '', paymentMode: e.paymentMode || 'CARD' }); setIsModalOpen(true); };

  const handleSave = async () => {
    if (formData.amount <= 0) { toast({ title: 'Amount must be greater than 0', variant: 'destructive' }); return; }
    if (!formData.description.trim()) { toast({ title: 'Description is required', variant: 'destructive' }); return; }
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = localStorage.getItem('token');
      if (editId) {
        const res = await fetch(`${base}api/expenses/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(formData) });
        if (!res.ok) throw new Error(await res.text());
      } else {
        await createMut.mutateAsync({ data: formData as any });
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
      const token = localStorage.getItem('token');
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
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4">Mode</th>
              <th className="px-6 py-4 text-right">Amount</th>
              <th className="px-6 py-4 text-center">Verified</th>
              {!isViewer && <th className="px-6 py-4 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading expenses...</td></tr>
            ) : expenses?.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No expenses recorded.</td></tr>
            ) : expenses?.map((e: any) => (
              <tr key={e.id} className="table-row-hover">
                <td className="px-6 py-4 text-muted-foreground">{formatDate(e.expenseDate)}</td>
                <td className="px-6 py-4 font-medium text-foreground">{e.description || 'Generic Expense'}</td>
                <td className="px-6 py-4"><Badge variant="neutral">{e.costType}</Badge></td>
                <td className="px-6 py-4 text-muted-foreground">{e.paymentMode}</td>
                <td className="px-6 py-4 text-right font-medium text-rose-600">{formatCurrency(e.amount)}</td>
                <td className="px-6 py-4 text-center"><VerifyButton verified={!!e.verified} isAdmin={isAdmin} onVerify={() => handleVerify(e.id)} onUnverify={() => handleUnverify(e.id)} /></td>
                {!isViewer && (
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(e)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Pencil size={14}/></button>
                      {isAdmin && <button onClick={() => setDeleteConfirm({ id: e.id, desc: e.description || 'this expense' })} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 transition-colors" title="Delete"><Trash2 size={14}/></button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editId ? "Edit Expense" : "Log Expense"} maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={createMut.isPending}>{editId ? 'Update' : 'Save'}</Button></>}>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Date</Label><Input type="date" max={new Date().toISOString().split('T')[0]} value={formData.expenseDate} onChange={(e:any) => setFormData({...formData, expenseDate: e.target.value})} /></div>
            <div><Label>Cost Type</Label><Select value={formData.costType} onChange={(e:any) => setFormData({...formData, costType: e.target.value})}><option value="FIXED">Fixed (Rent/Salary)</option><option value="VARIABLE">Variable (Supplies/Repairs)</option><option value="UTILITY">Utility (Water/Power)</option></Select></div>
          </div>
          <div><Label>Description</Label><Input value={formData.description} onChange={(e:any) => setFormData({...formData, description: e.target.value})} placeholder="e.g. Plumber repair" /></div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Amount</Label><Input type="number" step="0.01" value={formData.amount} onChange={(e:any) => setFormData({...formData, amount: Number(e.target.value)})} /></div>
            <div><Label>Payment Mode</Label><Select value={formData.paymentMode} onChange={(e:any) => setFormData({...formData, paymentMode: e.target.value})}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank Transfer</option></Select></div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Expense"
        footer={<><Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}>
        <p className="py-2 text-sm text-muted-foreground">Are you sure you want to delete <span className="font-semibold text-foreground">{deleteConfirm?.desc}</span>?</p>
      </Modal>
    </div>
  );
}
