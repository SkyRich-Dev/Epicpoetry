import React, { useState } from 'react';
import { useListIngredients, useCreateIngredient, useListCategories } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, Badge, formatCurrency, VerifyButton, apiVerify, apiUnverify } from '../components/ui-extras';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';

const emptyForm = { name: '', categoryId: 0, stockUom: 'g', purchaseUom: 'kg', recipeUom: 'g', conversionFactor: 1000, currentCost: 0, reorderLevel: 0, active: true };

export default function Ingredients() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const { data: ingredients, isLoading } = useListIngredients();
  const { data: categories } = useListCategories({ type: 'ingredient' });
  const createMut = useCreateIngredient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);

  const openCreate = () => {
    setEditId(null);
    setFormData({ ...emptyForm, categoryId: categories?.[0]?.id || 0 });
    setIsModalOpen(true);
  };

  const openEdit = (item: any) => {
    setEditId(item.id);
    setFormData({
      name: item.name, categoryId: item.categoryId || 0, stockUom: item.stockUom, purchaseUom: item.purchaseUom,
      recipeUom: item.recipeUom, conversionFactor: item.conversionFactor || 1000, currentCost: item.currentCost || 0,
      reorderLevel: item.reorderLevel || 0, active: item.active ?? true
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) { toast({ title: 'Ingredient name is required', variant: 'destructive' }); return; }
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = localStorage.getItem('token');
      if (editId) {
        const res = await fetch(`${base}api/ingredients/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(formData) });
        if (!res.ok) throw new Error(await res.text());
      } else {
        await createMut.mutateAsync({ data: formData as any });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/ingredients'] });
      setIsModalOpen(false);
      toast({ title: editId ? 'Ingredient updated' : 'Ingredient created' });
    } catch(e: any) { toast({ title: 'Failed to save ingredient', description: e.message, variant: 'destructive' }); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = localStorage.getItem('token');
      const res = await fetch(`${base}api/ingredients/${deleteConfirm.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: 'Delete failed' })); throw new Error(err.error || 'Delete failed'); }
      queryClient.invalidateQueries({ queryKey: ['/api/ingredients'] });
      setDeleteConfirm(null);
      toast({ title: 'Ingredient deleted' });
    } catch(e: any) { toast({ title: 'Cannot delete ingredient', description: e.message, variant: 'destructive' }); }
  };

  const handleVerify = async (id: number) => { await apiVerify('ingredients', id); queryClient.invalidateQueries({ queryKey: ['/api/ingredients'] }); };
  const handleUnverify = async (id: number) => { await apiUnverify('ingredients', id); queryClient.invalidateQueries({ queryKey: ['/api/ingredients'] }); };

  return (
    <div className="space-y-6">
      <PageHeader title="Ingredients Master" description="Manage raw materials and their measurement units">
        {!isViewer && <Button onClick={openCreate}><Plus size={18}/> Add Ingredient</Button>}
      </PageHeader>

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Code</th>
              <th className="px-6 py-4">Name</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4">Base UOM</th>
              <th className="px-6 py-4 text-right">Avg Cost</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-center">Verified</th>
              {!isViewer && <th className="px-6 py-4 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : ingredients?.map((item: any) => (
              <tr key={item.id} className="table-row-hover">
                <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{item.code}</td>
                <td className="px-6 py-4 font-medium text-foreground">{item.name}</td>
                <td className="px-6 py-4 text-muted-foreground">{item.categoryName || '-'}</td>
                <td className="px-6 py-4 text-muted-foreground">{item.stockUom}</td>
                <td className="px-6 py-4 text-right font-medium">{formatCurrency(item.weightedAvgCost)}</td>
                <td className="px-6 py-4 text-center"><Badge variant={item.active ? "success" : "neutral"}>{item.active ? 'Active' : 'Inactive'}</Badge></td>
                <td className="px-6 py-4 text-center"><VerifyButton verified={!!item.verified} isAdmin={isAdmin} onVerify={() => handleVerify(item.id)} onUnverify={() => handleUnverify(item.id)} /></td>
                {!isViewer && (
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Pencil size={14}/></button>
                      {isAdmin && <button onClick={() => setDeleteConfirm({ id: item.id, name: item.name })} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 transition-colors" title="Delete"><Trash2 size={14}/></button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editId ? "Edit Ingredient" : "Add Ingredient"} maxWidth="max-w-2xl"
        footer={<><Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={createMut.isPending}>{editId ? 'Update' : 'Save'}</Button></>}>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Name</Label><Input value={formData.name} onChange={(e:any) => setFormData({...formData, name: e.target.value})} placeholder="e.g. Arabica Beans" /></div>
            <div><Label>Category</Label><Select value={formData.categoryId} onChange={(e:any) => setFormData({...formData, categoryId: Number(e.target.value)})}><option value={0}>Select Category</option>{categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-5">
            <div><Label>Stock UOM</Label><Input value={formData.stockUom} onChange={(e:any) => setFormData({...formData, stockUom: e.target.value})} placeholder="e.g. g" /></div>
            <div><Label>Purchase UOM</Label><Input value={formData.purchaseUom} onChange={(e:any) => setFormData({...formData, purchaseUom: e.target.value})} placeholder="e.g. kg" /></div>
            <div><Label>Recipe UOM</Label><Input value={formData.recipeUom} onChange={(e:any) => setFormData({...formData, recipeUom: e.target.value})} placeholder="e.g. g" /></div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Conversion (Purch to Stock)</Label><Input type="number" value={formData.conversionFactor} onChange={(e:any) => setFormData({...formData, conversionFactor: Number(e.target.value)})} /><p className="text-[10px] text-muted-foreground mt-1">1 Purchase UOM = X Stock UOM</p></div>
            <div><Label>Est. Cost (Per Stock UOM)</Label><Input type="number" step="0.01" value={formData.currentCost} onChange={(e:any) => setFormData({...formData, currentCost: Number(e.target.value)})} /></div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Ingredient"
        footer={<><Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}>
        <p className="py-2 text-sm text-muted-foreground">Are you sure you want to delete <span className="font-semibold text-foreground">{deleteConfirm?.name}</span>? This cannot be undone.</p>
      </Modal>
    </div>
  );
}
