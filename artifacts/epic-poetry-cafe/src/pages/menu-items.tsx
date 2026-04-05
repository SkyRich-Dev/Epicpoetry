import React, { useState } from 'react';
import { useListMenuItems, useCreateMenuItem, useUpdateMenuItem, useGetRecipe, useSaveRecipe, useGetMenuItemCosting, useListIngredients, useListCategories } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, Badge, cn, VerifyButton, apiVerify, apiUnverify } from '../components/ui-extras';
import { Plus, Edit, ChefHat, Tag, DollarSign, Calculator, Trash2, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';

export default function MenuItems() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const { data: menuItems, isLoading } = useListMenuItems();
  const { data: categories } = useListCategories({ type: 'menu' });
  const { toast } = useToast();
  const createMut = useCreateMenuItem();
  const updateMut = useUpdateMenuItem();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);

  const [formData, setFormData] = useState({ name: '', categoryId: 0, sellingPrice: 0, active: true });

  const openCreate = () => {
    setEditId(null);
    setFormData({ name: '', categoryId: categories?.[0]?.id || 0, sellingPrice: 0, active: true });
    setIsModalOpen(true);
  };

  const openEdit = (item: any) => {
    setEditId(item.id);
    setFormData({ name: item.name, categoryId: item.categoryId || 0, sellingPrice: Number(item.sellingPrice) || 0, active: item.active ?? true });
    setIsModalOpen(true);
  };

  const handleSaveItem = async () => {
    if (!formData.name?.trim()) { toast({ title: 'Item name is required', variant: 'destructive' }); return; }
    if ((formData as any).sellingPrice <= 0) { toast({ title: 'Selling price must be greater than 0', variant: 'destructive' }); return; }
    try {
      if (editId) {
        await updateMut.mutateAsync({ id: editId, data: formData as any });
      } else {
        await createMut.mutateAsync({ data: formData as any });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] });
      setIsModalOpen(false);
      toast({ title: editId ? 'Menu item updated' : 'Menu item created' });
    } catch (e: any) { toast({ title: 'Failed to save menu item', description: e.message, variant: 'destructive' }); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = localStorage.getItem('token');
      const res = await fetch(`${base}api/menu-items/${deleteConfirm.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: 'Delete failed' })); throw new Error(err.error || 'Delete failed'); }
      queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] });
      setDeleteConfirm(null);
      toast({ title: 'Menu item deleted' });
    } catch(e: any) { toast({ title: 'Cannot delete menu item', description: e.message, variant: 'destructive' }); }
  };

  const openRecipe = (item: any) => { setActiveItem(item); setRecipeModalOpen(true); };

  const handleVerify = async (id: number) => { await apiVerify('menu-items', id); queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] }); };
  const handleUnverify = async (id: number) => { await apiUnverify('menu-items', id); queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] }); };

  return (
    <div className="space-y-6">
      <PageHeader title="Menu & Recipes" description="Manage your offerings, prices, and complex recipes">
        {!isViewer && <Button onClick={openCreate}><Plus size={18}/> Add Menu Item</Button>}
      </PageHeader>

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Item Name</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4 text-right">Selling Price</th>
              {isAdmin && <th className="px-6 py-4 text-right">Prod. Cost</th>}
              {isAdmin && <th className="px-6 py-4 text-right">Margin</th>}
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-center">Verified</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={isAdmin ? 8 : 6} className="px-6 py-8 text-center text-muted-foreground">Loading menu items...</td></tr>
            ) : menuItems?.length === 0 ? (
               <tr><td colSpan={isAdmin ? 8 : 6} className="px-6 py-8 text-center text-muted-foreground">No menu items found. Create your first one!</td></tr>
            ) : menuItems?.map((item: any) => (
              <tr key={item.id} className="table-row-hover">
                <td className="px-6 py-4 font-medium text-foreground">{item.name}</td>
                <td className="px-6 py-4 text-muted-foreground">{item.categoryName || '-'}</td>
                <td className="px-6 py-4 text-right font-medium">{formatCurrency(item.sellingPrice)}</td>
                {isAdmin && <td className="px-6 py-4 text-right text-muted-foreground">{formatCurrency(item.productionCost)}</td>}
                {isAdmin && (
                  <td className="px-6 py-4 text-right">
                    <Badge variant={item.marginPercent < 30 ? "danger" : item.marginPercent > 60 ? "success" : "warning"}>
                      {Number(item.marginPercent).toFixed(2)}%
                    </Badge>
                  </td>
                )}
                <td className="px-6 py-4 text-center"><Badge variant={item.active ? "success" : "neutral"}>{item.active ? 'Active' : 'Inactive'}</Badge></td>
                <td className="px-6 py-4 text-center"><VerifyButton verified={!!item.verified} isAdmin={isAdmin} onVerify={() => handleVerify(item.id)} onUnverify={() => handleUnverify(item.id)} /></td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="outline" className="px-3 py-1.5 h-auto text-xs" onClick={() => openRecipe(item)}>
                      <ChefHat size={14} className="mr-1"/> Recipe
                    </Button>
                    {!isViewer && (
                      <>
                        <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Pencil size={14}/></button>
                        {isAdmin && <button onClick={() => setDeleteConfirm({ id: item.id, name: item.name })} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 transition-colors" title="Delete"><Trash2 size={14}/></button>}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editId ? "Edit Menu Item" : "Add Menu Item"} maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button onClick={handleSaveItem} disabled={createMut.isPending || updateMut.isPending}>{editId ? 'Update' : 'Save'}</Button></>}>
        <div className="space-y-4 py-2">
          <div>
            <Label>Item Name</Label>
            <Input value={formData.name} onChange={(e:any) => setFormData({...formData, name: e.target.value})} placeholder="e.g. Mocha Latte" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Category</Label>
              <Select value={formData.categoryId} onChange={(e:any) => setFormData({...formData, categoryId: Number(e.target.value)})}>
                <option value={0}>Select Category</option>
                {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Selling Price</Label>
              <Input type="number" step="0.01" value={formData.sellingPrice || ''} onChange={(e:any) => setFormData({...formData, sellingPrice: Number(e.target.value)})} />
            </div>
          </div>
          {editId && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="active-toggle" checked={formData.active} onChange={e => setFormData({...formData, active: e.target.checked})} />
              <Label htmlFor="active-toggle" className="mb-0">Active</Label>
            </div>
          )}
        </div>
      </Modal>

      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Menu Item"
        footer={<><Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}>
        <p className="py-2 text-sm text-muted-foreground">Are you sure you want to delete <span className="font-semibold text-foreground">{deleteConfirm?.name}</span>? This will also remove its recipe.</p>
      </Modal>

      {recipeModalOpen && activeItem && (
        <RecipeBuilderModal item={activeItem} onClose={() => setRecipeModalOpen(false)} isViewer={isViewer} />
      )}
    </div>
  );
}

function RecipeBuilderModal({ item, onClose, isViewer }: { item: any, onClose: () => void, isViewer: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: initialRecipe, isLoading } = useGetRecipe(item.id);
  const { data: costing, refetch: refetchCosting } = useGetMenuItemCosting(item.id);
  const { data: ingredients } = useListIngredients({ active: true });
  const saveMut = useSaveRecipe();

  const [lines, setLines] = useState<any[]>([]);

  React.useEffect(() => {
    if (initialRecipe) {
      setLines(initialRecipe.map((r: any) => ({
        ingredientId: r.ingredientId,
        quantity: r.quantity,
        uom: r.uom,
        wastagePercent: r.wastagePercent || 0
      })));
    }
  }, [initialRecipe]);

  const addLine = () => setLines([...lines, { ingredientId: 0, quantity: 1, uom: 'g', wastagePercent: 0 }]);
  const removeLine = (index: number) => setLines(lines.filter((_, i) => i !== index));
  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    if (field === 'ingredientId') {
      const ing = ingredients?.find(i => i.id === value);
      if (ing) newLines[index].uom = ing.recipeUom;
    }
    setLines(newLines);
  };

  const handleSave = async () => {
    try {
      const validLines = lines.filter(l => l.ingredientId > 0);
      await saveMut.mutateAsync({ id: item.id, data: { lines: validLines } });
      queryClient.invalidateQueries({ queryKey: [`/api/menu-items/${item.id}/recipe`] });
      queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] });
      refetchCosting();
    } catch (e: any) { toast({ title: 'Failed to save recipe', description: e.message, variant: 'destructive' }); }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`Recipe: ${item.name}`} maxWidth="max-w-4xl"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button>{!isViewer && <Button onClick={handleSave} disabled={saveMut.isPending}>Save Recipe</Button>}</>}>

      {isLoading ? <div className="p-8 text-center">Loading recipe...</div> : (
        <div className="space-y-6">
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 flex flex-wrap gap-6 items-center justify-between">
            <div className="flex gap-8">
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Selling Price</p>
                <p className="text-xl font-display font-bold text-foreground">{formatCurrency(item.sellingPrice)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Prod. Cost</p>
                <p className="text-xl font-display font-bold text-rose-600">{formatCurrency(costing?.totalProductionCost || 0)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Est. Margin</p>
                <p className={cn("text-xl font-display font-bold", (costing?.margin || 0) > 0 ? "text-emerald-600" : "text-rose-600")}>
                  {formatCurrency(costing?.margin || 0)} <span className="text-sm font-medium">({Number(costing?.marginPercent || 0).toFixed(2)}%)</span>
                </p>
              </div>
            </div>
            <Calculator className="text-primary/30" size={48} />
          </div>

          <div>
            <div className="flex justify-between items-end mb-3">
              <h3 className="font-semibold text-foreground">Ingredients & Quantities</h3>
              {!isViewer && <Button variant="outline" size="sm" onClick={addLine}><Plus size={14}/> Add Ingredient</Button>}
            </div>

            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 bg-muted/30 border border-border/50 rounded-xl group transition-colors hover:border-border">
                  <div className="flex-1">
                    <Select value={line.ingredientId} onChange={(e:any) => updateLine(idx, 'ingredientId', Number(e.target.value))} disabled={isViewer}>
                      <option value={0}>Select Ingredient...</option>
                      {ingredients?.map(ing => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                    </Select>
                  </div>
                  <div className="w-24">
                    <Input type="number" step="0.01" value={line.quantity} onChange={(e:any) => updateLine(idx, 'quantity', Number(e.target.value))} placeholder="Qty" readOnly={isViewer} />
                  </div>
                  <div className="w-20">
                    <Input value={line.uom} readOnly className="bg-muted text-muted-foreground cursor-not-allowed" />
                  </div>
                  <div className="w-24 relative">
                    <Input type="number" value={line.wastagePercent} onChange={(e:any) => updateLine(idx, 'wastagePercent', Number(e.target.value))} placeholder="Waste %" readOnly={isViewer} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                  {!isViewer && (
                    <button onClick={() => removeLine(idx)} className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              ))}
              {lines.length === 0 && (
                <div className="p-8 text-center border-2 border-dashed border-border rounded-xl text-muted-foreground">
                  No ingredients added yet. {!isViewer && 'Click "Add Ingredient" to start building this recipe.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
