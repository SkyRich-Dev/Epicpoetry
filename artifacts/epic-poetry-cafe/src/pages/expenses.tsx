import React, { useState } from 'react';
import { useListExpenses, useCreateExpense } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, formatDate, Badge, DateFilter } from '../components/ui-extras';
import { Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export default function Expenses() {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const dateParams = { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  const { data: expenses, isLoading } = useListExpenses(Object.keys(dateParams).length ? dateParams : undefined);
  const createMut = useCreateExpense();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ 
    expenseDate: new Date().toISOString().split('T')[0], 
    amount: 0, 
    costType: 'FIXED',
    description: '',
    paymentMode: 'CARD'
  });

  const handleSave = async () => {
    try {
      await createMut.mutateAsync({ data: formData as any });
      queryClient.invalidateQueries({ queryKey: ['/api/expenses'] });
      setIsModalOpen(false);
    } catch(e) { console.error(e); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" description="Manage operational costs, utilities, and generic expenses">
        <Button onClick={() => setIsModalOpen(true)}><Plus size={18}/> Log Expense</Button>
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
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading expenses...</td></tr>
            ) : expenses?.map(e => (
              <tr key={e.id} className="table-row-hover">
                <td className="px-6 py-4 text-muted-foreground">{formatDate(e.expenseDate)}</td>
                <td className="px-6 py-4 font-medium text-foreground">{e.description || 'Generic Expense'}</td>
                <td className="px-6 py-4"><Badge variant="neutral">{e.costType}</Badge></td>
                <td className="px-6 py-4 text-muted-foreground">{e.paymentMode}</td>
                <td className="px-6 py-4 text-right font-medium text-rose-600">{formatCurrency(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Log Expense"
        footer={<><Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={createMut.isPending}>Save</Button></>}>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Date</Label><Input type="date" value={formData.expenseDate} onChange={(e:any) => setFormData({...formData, expenseDate: e.target.value})} /></div>
            <div>
              <Label>Cost Type</Label>
              <Select value={formData.costType} onChange={(e:any) => setFormData({...formData, costType: e.target.value})}>
                <option value="FIXED">Fixed (Rent/Salary)</option>
                <option value="VARIABLE">Variable (Supplies/Repairs)</option>
                <option value="UTILITY">Utility (Water/Power)</option>
              </Select>
            </div>
          </div>
          <div><Label>Description</Label><Input value={formData.description} onChange={(e:any) => setFormData({...formData, description: e.target.value})} placeholder="e.g. Plumber repair" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Amount ($)</Label><Input type="number" step="0.01" value={formData.amount} onChange={(e:any) => setFormData({...formData, amount: Number(e.target.value)})} /></div>
            <div>
              <Label>Payment Mode</Label>
              <Select value={formData.paymentMode} onChange={(e:any) => setFormData({...formData, paymentMode: e.target.value})}>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
              </Select>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
