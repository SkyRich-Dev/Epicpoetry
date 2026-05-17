import React, { useState, useMemo } from 'react';
import { useListIngredients, useCreateIngredient, useListCategories } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, Badge, formatCurrency, VerifyButton, apiVerify, apiUnverify, useFormDirty, useClientPagination, TablePagination } from '../components/ui-extras';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';
import { getAuthToken } from '../lib/auth-storage';

const COMMON_UOMS = ['g', 'kg', 'ml', 'L', 'pcs', 'nos', 'piece', 'box', 'pack', 'dozen', 'bottle', 'can'];

function UomInput({ value, onChange, placeholder, listId }: { value: string; onChange: (v: string) => void; placeholder?: string; listId: string }) {
  return (
    <>
      <Input list={listId} value={value} onChange={(e: any) => onChange(e.target.value)} placeholder={placeholder} />
      <datalist id={listId}>{COMMON_UOMS.map(u => <option key={u} value={u} />)}</datalist>
    </>
  );
}

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
  const [dupConfirm, setDupConfirm] = useState<{ message: string; kind: 'exact' | 'similar'; canConfirm: boolean; matches: any[] } | null>(null);
  const ingFormDirty = useFormDirty(isModalOpen, formData);
  const [search, setSearch] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState<number | 'all'>('all');
  const [sortBy, setSortBy] = useState<'name-asc' | 'name-desc' | 'category' | 'cost-asc' | 'cost-desc'>('name-asc');

  const filteredSorted = useMemo(() => {
    if (!ingredients) return [];
    const q = search.trim().toLowerCase();
    let rows = (ingredients as any[]).filter((i: any) => {
      if (filterCategoryId !== 'all' && (i.categoryId ?? null) !== filterCategoryId) return false;
      if (!q) return true;
      return (i.name?.toLowerCase().includes(q)) || (i.code?.toLowerCase().includes(q));
    });
    rows = [...rows].sort((a: any, b: any) => {
      switch (sortBy) {
        case 'name-asc': return (a.name || '').localeCompare(b.name || '');
        case 'name-desc': return (b.name || '').localeCompare(a.name || '');
        case 'category': return (a.categoryName || 'zzzz').localeCompare(b.categoryName || 'zzzz') || (a.name || '').localeCompare(b.name || '');
        case 'cost-asc': return (a.weightedAvgCost || 0) - (b.weightedAvgCost || 0);
        case 'cost-desc': return (b.weightedAvgCost || 0) - (a.weightedAvgCost || 0);
        default: return 0;
      }
    });
    return rows;
  }, [ingredients, search, filterCategoryId, sortBy]);
  const ingredientsPagination = useClientPagination(filteredSorted, 10);

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

  const submitSave = async (extraFlags: { confirmDuplicate?: boolean; confirmSimilar?: boolean } = {}) => {
    const base = import.meta.env.BASE_URL || '/';
    const token = getAuthToken();
    const payload: any = { ...formData, ...extraFlags };
    const url = editId ? `${base}api/ingredients/${editId}` : `${base}api/ingredients`;
    const method = editId ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      if (body && body.duplicateKind) {
        return { needsConfirm: true, body };
      }
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = text;
      try { const j = JSON.parse(text); msg = j.error || text; } catch { /* keep raw */ }
      throw new Error(msg);
    }
    return { needsConfirm: false };
  };

  const handleSave = async () => {
    if (!formData.name.trim()) { toast({ title: 'Ingredient name is required', variant: 'destructive' }); return; }
    if (!categories || categories.length === 0) { toast({ title: 'Create an ingredient category first', description: 'Go to Masters and add at least one category with type Ingredient before creating ingredients.', variant: 'destructive' }); return; }
    if (!formData.categoryId || formData.categoryId <= 0) { toast({ title: 'Please select an ingredient category', variant: 'destructive' }); return; }
    if (!formData.stockUom.trim() || !formData.purchaseUom.trim() || !formData.recipeUom.trim()) { toast({ title: 'All UOM fields are required', variant: 'destructive' }); return; }
    if (formData.conversionFactor <= 0) { toast({ title: 'Conversion factor must be greater than 0', variant: 'destructive' }); return; }
    try {
      const r = await submitSave();
      if (r.needsConfirm) {
        const b = (r as any).body;
        if (!b.canConfirm) {
          toast({ title: 'Duplicate ingredient', description: b.error, variant: 'destructive' });
          return;
        }
        setDupConfirm({ message: b.error, kind: b.duplicateKind, canConfirm: !!b.canConfirm, matches: b.duplicates || [] });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['/api/ingredients'] });
      setIsModalOpen(false);
      toast({ title: editId ? 'Ingredient updated' : 'Ingredient created' });
    } catch(e: any) { toast({ title: 'Failed to save ingredient', description: e.message, variant: 'destructive' }); }
  };

  const handleConfirmDuplicate = async () => {
    if (!dupConfirm) return;
    try {
      const flags = dupConfirm.kind === 'exact' ? { confirmDuplicate: true } : { confirmSimilar: true };
      await submitSave(flags);
      queryClient.invalidateQueries({ queryKey: ['/api/ingredients'] });
      setDupConfirm(null);
      setIsModalOpen(false);
      toast({ title: editId ? 'Ingredient updated' : 'Ingredient created' });
    } catch (e: any) { toast({ title: 'Failed to save ingredient', description: e.message, variant: 'destructive' }); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = getAuthToken();
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

      <div className="flex flex-wrap items-end gap-3" data-testid="ingredients-filters">
        <div className="flex-1 min-w-[220px]">
          <Label>Search</Label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              data-testid="input-search-ingredients"
              className="pl-9"
              placeholder="Search by name or code..."
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="w-56">
          <Label>Category</Label>
          <Select
            data-testid="select-filter-category"
            value={String(filterCategoryId)}
            onChange={(e: any) => setFilterCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All categories</option>
            {categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div className="w-56">
          <Label>Sort by</Label>
          <Select
            data-testid="select-sort-by"
            value={sortBy}
            onChange={(e: any) => setSortBy(e.target.value as any)}
          >
            <option value="name-asc">Name (A &rarr; Z)</option>
            <option value="name-desc">Name (Z &rarr; A)</option>
            <option value="category">Category</option>
            <option value="cost-asc">Cost (low &rarr; high)</option>
            <option value="cost-desc">Cost (high &rarr; low)</option>
          </Select>
        </div>
      </div>

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
          <tbody className="divide-y divide-border" data-testid="ingredients-table-body">
            {isLoading ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : filteredSorted.length === 0 ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">No ingredients match your filters.</td></tr>
            ) : ingredientsPagination.paginatedRows.map((item: any) => (
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
        <TablePagination {...ingredientsPagination} onPageChange={ingredientsPagination.setPage} />
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} dirty={ingFormDirty} title={editId ? "Edit Ingredient" : "Add Ingredient"} maxWidth="max-w-2xl"
        footer={(close) => <><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={handleSave} disabled={createMut.isPending || !categories || categories.length === 0}>{editId ? 'Update' : 'Save'}</Button></>}>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Name</Label><Input value={formData.name} onChange={(e:any) => setFormData({...formData, name: e.target.value})} placeholder="e.g. Arabica Beans" /></div>
            <div><Label>Category</Label><Select value={formData.categoryId} onChange={(e:any) => setFormData({...formData, categoryId: Number(e.target.value)})}><option value={0}>Select Category</option>{categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>{(!categories || categories.length === 0) && <p className="text-[11px] text-amber-600 mt-1">No ingredient categories found. Create one in Masters first.</p>}</div>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-5">
            <div>
              <Label>Stock UOM</Label>
              <UomInput listId="uom-stock" value={formData.stockUom} onChange={(v) => setFormData({...formData, stockUom: v})} placeholder="e.g. g, ml, pcs" />
            </div>
            <div>
              <Label>Purchase UOM</Label>
              <UomInput listId="uom-purchase" value={formData.purchaseUom} onChange={(v) => setFormData({...formData, purchaseUom: v})} placeholder="e.g. kg, L, box" />
            </div>
            <div>
              <Label>Recipe UOM</Label>
              <UomInput listId="uom-recipe" value={formData.recipeUom} onChange={(v) => setFormData({...formData, recipeUom: v})} placeholder="e.g. g, ml, pcs" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">Tip: For items counted by piece, use <span className="font-mono">pcs</span> or <span className="font-mono">nos</span> (e.g. "10 nos of lemon"). Set the conversion factor to <span className="font-mono">1</span> when stock and purchase UOM are both pieces.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Conversion (Purch to Stock)</Label><Input type="number" value={formData.conversionFactor} onChange={(e:any) => setFormData({...formData, conversionFactor: Number(e.target.value)})} /><p className="text-[10px] text-muted-foreground mt-1">1 Purchase UOM = X Stock UOM</p></div>
            <div><Label>Est. Cost (Per Stock UOM)</Label><Input type="number" step="0.01" value={formData.currentCost} onChange={(e:any) => setFormData({...formData, currentCost: Number(e.target.value)})} /></div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Ingredient"
        footer={(close) => <><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}>
        <p className="py-2 text-sm text-muted-foreground">Are you sure you want to delete <span className="font-semibold text-foreground">{deleteConfirm?.name}</span>? This cannot be undone.</p>
      </Modal>

      <Modal isOpen={!!dupConfirm} onClose={() => setDupConfirm(null)} title={dupConfirm?.kind === 'exact' ? 'Possible duplicate found' : 'Similar name found'}
        footer={<><Button variant="ghost" onClick={() => setDupConfirm(null)} data-testid="dup-cancel">Cancel</Button><Button onClick={handleConfirmDuplicate} data-testid="dup-confirm">{dupConfirm?.kind === 'exact' ? 'Update existing record' : 'Create anyway'}</Button></>}>
        <div className="py-2 space-y-3 text-sm">
          <p className="text-muted-foreground">{dupConfirm?.message}</p>
          {dupConfirm?.matches && dupConfirm.matches.length > 0 && (
            <div className="border rounded-lg divide-y" data-testid="dup-matches">
              {dupConfirm.matches.slice(0, 5).map((m: any) => (
                <div key={m.id} className="p-2.5 flex items-center justify-between text-xs">
                  <span className="font-medium">{m.name} <span className="font-mono text-muted-foreground ml-1">({m.code})</span></span>
                  <span className="text-muted-foreground">{m.categoryName || 'uncategorized'}{m.matchType !== 'exact' ? ` · ${m.matchType === 'stem' ? 'singular/plural' : '1-letter diff'}` : ''}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {dupConfirm?.kind === 'exact'
              ? 'Confirming will update the existing record with the values you entered (and move it to the new category if changed).'
              : 'Confirming will create this as a separate ingredient. Use only if it really is a different item.'}
          </p>
        </div>
      </Modal>
    </div>
  );
}
