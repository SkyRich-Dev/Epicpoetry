import React, { useState } from 'react';
import { useListWasteEntries, useCreateWasteEntry, useListIngredients } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, formatDate, Badge, DateFilter, VerifyButton, apiVerify, apiUnverify } from '../components/ui-extras';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';

export default function Waste() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const dateParams = { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  const { data: waste, isLoading } = useListWasteEntries(Object.keys(dateParams).length ? dateParams : undefined);
  const { data: ingredients } = useListIngredients();
  const createMut = useCreateWasteEntry();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ wasteDate: new Date().toISOString().split('T')[0], wasteType: 'INGREDIENT', ingredientId: 0, quantity: 1, uom: 'g', reason: '' });
  const { toast } = useToast();
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);

  const openCreate = () => { setEditId(null); setFormData({ wasteDate: new Date().toISOString().split('T')[0], wasteType: 'INGREDIENT', ingredientId: 0, quantity: 1, uom: 'g', reason: '' }); setIsModalOpen(true); };
  const openEdit = (w: any) => { setEditId(w.id); setFormData({ wasteDate: w.wasteDate, wasteType: w.wasteType, ingredientId: w.ingredientId || 0, quantity: Number(w.quantity), uom: w.uom, reason: w.reason || '' }); setIsModalOpen(true); };

  const handleSave = async () => {
    if (formData.wasteType === 'INGREDIENT' && !formData.ingredientId) { toast({ title: 'Please select an ingredient', variant: 'destructive' }); return; }
    if (formData.quantity <= 0) { toast({ title: 'Quantity must be greater than 0', variant: 'destructive' }); return; }
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = localStorage.getItem('token');
      if (editId) {
        const res = await fetch(`${base}api/waste/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(formData) });
        if (!res.ok) throw new Error(await res.text());
      } else {
        await createMut.mutateAsync({ data: formData as any });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/waste'] });
      setIsModalOpen(false);
      toast({ title: editId ? 'Waste entry updated' : 'Waste entry logged' });
    } catch(e: any) { toast({ title: 'Failed to save waste entry', description: e.message, variant: 'destructive' }); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = localStorage.getItem('token');
      const res = await fetch(`${base}api/waste/${deleteConfirm.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ['/api/waste'] });
      setDeleteConfirm(null);
      toast({ title: 'Waste entry deleted' });
    } catch(e: any) { toast({ title: 'Failed to delete waste entry', description: e.message, variant: 'destructive' }); }
  };

  const handleVerify = async (id: number) => { await apiVerify('waste', id); queryClient.invalidateQueries({ queryKey: ['/api/waste'] }); };
  const handleUnverify = async (id: number) => { await apiUnverify('waste', id); queryClient.invalidateQueries({ queryKey: ['/api/waste'] }); };

  return (
    <div className="space-y-6">
      <PageHeader title="Waste Log" description="Track spoiled, expired, or damaged items">
        {!isViewer && <Button onClick={openCreate} variant="danger"><Trash2 size={18} className="mr-1"/> Log Waste</Button>}
      </PageHeader>

      <DateFilter fromDate={fromDate} toDate={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t); }} />

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Item</th>
              <th className="px-6 py-4">Reason</th>
              <th className="px-6 py-4 text-right">Quantity</th>
              <th className="px-6 py-4 text-right">Cost Value</th>
              <th className="px-6 py-4 text-center">Verified</th>
              {!isViewer && <th className="px-6 py-4 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : waste?.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No waste entries.</td></tr>
            ) : waste?.map((w: any) => (
              <tr key={w.id} className="table-row-hover">
                <td className="px-6 py-4 text-muted-foreground">{formatDate(w.wasteDate)}</td>
                <td className="px-6 py-4 font-medium text-foreground">{w.ingredientName || w.menuItemName} <Badge variant="neutral" className="ml-2 px-1">{w.wasteType}</Badge></td>
                <td className="px-6 py-4 text-muted-foreground">{w.reason}</td>
                <td className="px-6 py-4 text-right">{Number(w.quantity).toFixed(2)} {w.uom}</td>
                <td className="px-6 py-4 text-right font-medium text-rose-600">{formatCurrency(w.costValue)}</td>
                <td className="px-6 py-4 text-center"><VerifyButton verified={!!w.verified} isAdmin={isAdmin} onVerify={() => handleVerify(w.id)} onUnverify={() => handleUnverify(w.id)} /></td>
                {!isViewer && (
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(w)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Pencil size={14}/></button>
                      {isAdmin && <button onClick={() => setDeleteConfirm({ id: w.id, name: w.ingredientName || w.menuItemName })} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 transition-colors" title="Delete"><Trash2 size={14}/></button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editId ? "Edit Waste Entry" : "Log Waste"} maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button onClick={handleSave} variant="danger" disabled={createMut.isPending}>{editId ? 'Update' : 'Confirm Log'}</Button></>}>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Date</Label><Input type="date" max={new Date().toISOString().split('T')[0]} value={formData.wasteDate} onChange={(e:any) => setFormData({...formData, wasteDate: e.target.value})} /></div>
            <div><Label>Waste Type</Label><Select value={formData.wasteType} onChange={(e:any) => setFormData({...formData, wasteType: e.target.value})}><option value="INGREDIENT">Raw Ingredient</option><option value="MENU_ITEM">Prepared Menu Item</option></Select></div>
          </div>
          <div><Label>Item</Label><Select value={formData.ingredientId} onChange={(e:any) => setFormData({...formData, ingredientId: Number(e.target.value)})}><option value={0}>Select Item...</option>{ingredients?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Quantity</Label><Input type="number" step="0.01" value={formData.quantity} onChange={(e:any) => setFormData({...formData, quantity: Number(e.target.value)})} /></div>
            <div><Label>UOM</Label><Input value={formData.uom} onChange={(e:any) => setFormData({...formData, uom: e.target.value})} /></div>
          </div>
          <div><Label>Reason</Label><Input value={formData.reason} onChange={(e:any) => setFormData({...formData, reason: e.target.value})} placeholder="e.g. Expired, Spilled" /></div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Waste Entry"
        footer={<><Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}>
        <p className="py-2 text-sm text-muted-foreground">Delete waste entry for <span className="font-semibold text-foreground">{deleteConfirm?.name}</span>?</p>
      </Modal>
    </div>
  );
}
