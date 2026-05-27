import React, { useState } from 'react';
import { useListPurchases, useCreatePurchase, useListVendors, useListIngredients, useGetPettyCashSummary } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, Badge, formatDate, DateFilter, VerifyButton, apiVerify, apiUnverify, useFormDirty, useClientPagination, TablePagination } from '../components/ui-extras';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';
import { getAuthToken } from '../lib/auth-storage';

const BASE = import.meta.env.BASE_URL || '/';

export default function Purchases() {
  const queryClient = useQueryClient();
  const { user, hasPerm } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const isViewer = user?.role === 'viewer';
  const canCreate = hasPerm('purchases.create');
  const canEdit = hasPerm('purchases.edit');
  const canDelete = hasPerm('purchases.delete');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const dateParams = { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  const { data: purchases, isLoading } = useListPurchases(Object.keys(dateParams).length ? dateParams : undefined);
  const { data: vendors } = useListVendors();
  const { data: ingredients } = useListIngredients();
  const { data: pettyCashSummary } = useGetPettyCashSummary();
  
  const { toast } = useToast();
  const createMut = useCreatePurchase();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPurchaseId, setEditingPurchaseId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isPurchaseDetailLoading, setIsPurchaseDetailLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    purchaseDate: new Date().toISOString().split('T')[0],
    vendorId: 0,
    invoiceNumber: '',
    isPaid: false,
    paymentMode: 'cash' as 'cash' | 'petty_cash' | 'account' | 'upi',
  });

  const [lines, setLines] = useState<any[]>([]);
  const purchaseFormDirty = useFormDirty(isModalOpen, { formData, lines });
  const purchasesPagination = useClientPagination(purchases || [], 5);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPurchaseId(null);
  };

  const openCreate = () => {
    setEditingPurchaseId(null);
    setFormData({ purchaseDate: new Date().toISOString().split('T')[0], vendorId: vendors?.[0]?.id || 0, invoiceNumber: '', isPaid: false, paymentMode: 'cash' });
    setLines([{ ingredientId: 0, quantity: 1, unitRate: 0, taxPercent: 0, expiryDate: '' }]);
    setIsModalOpen(true);
  };

  const openEdit = (purchaseId: number) => {
    setEditingPurchaseId(purchaseId);
    setLines([]);
    setIsModalOpen(true);
    const token = getAuthToken();
    setIsPurchaseDetailLoading(true);
    fetch(`${BASE}api/purchases/${purchaseId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      })
      .then((detail) => {
        const rawPaymentMode = String(detail.purchase.paymentMode || 'cash').toLowerCase();
        const paymentMode = rawPaymentMode === 'petty_cash' || rawPaymentMode === 'account' || rawPaymentMode === 'upi' ? rawPaymentMode : 'cash';
        setFormData({
          purchaseDate: detail.purchase.purchaseDate,
          vendorId: detail.purchase.vendorId,
          invoiceNumber: detail.purchase.invoiceNumber || '',
          isPaid: detail.purchase.paymentStatus === 'fully_paid',
          paymentMode,
        });
        setLines((detail.lines || []).map((line: any) => ({
          ingredientId: line.ingredientId,
          quantity: line.quantity,
          purchaseUom: line.purchaseUom || 'unit',
          unitRate: line.unitRate,
          taxPercent: line.taxPercent ?? 0,
          expiryDate: line.expiryDate || '',
        })));
      })
      .catch((e: any) => {
        toast({ title: 'Failed to load purchase', description: e.message, variant: 'destructive' });
        closeModal();
      })
      .finally(() => setIsPurchaseDetailLoading(false));
  };

  const addLine = () => setLines([...lines, { ingredientId: 0, quantity: 1, unitRate: 0, taxPercent: 0, expiryDate: '' }]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: string, val: any) => {
    const newLines = [...lines];
    newLines[idx][field] = val;
    setLines(newLines);
  };

  const calcTotal = () => {
    return lines.reduce((acc, l) => {
      const base = l.quantity * l.unitRate;
      const tax = base * (l.taxPercent / 100);
      return acc + base + tax;
    }, 0);
  };

  const purchaseTotal = calcTotal();
  const availablePettyCashBalance = Number(pettyCashSummary?.currentBalance || 0);
  const isPettyCashPayment = formData.isPaid && formData.paymentMode === 'petty_cash';
  const insufficientPettyCash = isPettyCashPayment && purchaseTotal > availablePettyCashBalance + 0.01;

  const handleSave = async () => {
    if (!formData.vendorId) { toast({ title: 'Please select a vendor', variant: 'destructive' }); return; }
    const incompleteLine = lines.find(l => !l.ingredientId || l.ingredientId <= 0 || !l.quantity || l.quantity <= 0);
    if (incompleteLine) { toast({ title: 'Complete every purchase row', description: 'Each row needs an ingredient and quantity greater than 0.', variant: 'destructive' }); return; }
    const validLines = lines.filter(l => l.ingredientId > 0 && l.quantity > 0);
    if (validLines.length === 0) { toast({ title: 'Add at least one item with quantity', variant: 'destructive' }); return; }
    if (insufficientPettyCash) {
      toast({
        title: 'Insufficient petty cash balance',
        description: `Available: ${formatCurrency(availablePettyCashBalance)}. Required: ${formatCurrency(purchaseTotal)}.`,
        variant: 'destructive',
      });
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    for (const l of validLines) {
      if (l.expiryDate && l.expiryDate < today) {
        toast({ title: 'Expiry date cannot be in the past', variant: 'destructive' });
        return;
      }
    }
    try {
      const payload = {
        purchaseDate: formData.purchaseDate,
        vendorId: formData.vendorId,
        invoiceNumber: formData.invoiceNumber,
        paymentStatus: formData.isPaid ? 'paid' : 'unpaid',
        paymentMode: formData.isPaid ? formData.paymentMode : undefined,
        lines: validLines.map(l => ({ ...l, expiryDate: l.expiryDate || null })),
      };
      if (editingPurchaseId) {
        const token = getAuthToken();
        setIsSavingEdit(true);
        const res = await fetch(`${BASE}api/purchases/${editingPurchaseId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        await createMut.mutateAsync({ data: payload as any });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash'] });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/expenses'] });
      closeModal();
      toast({ title: editingPurchaseId ? 'Purchase updated' : 'Purchase recorded' });
    } catch (e: any) { toast({ title: 'Failed to save purchase', description: e.message, variant: 'destructive' }); }
    finally { setIsSavingEdit(false); }
  };

  const handleVerify = async (id: number) => {
    await apiVerify('purchases', id);
    queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
  };
  const handleUnverify = async (id: number) => {
    await apiUnverify('purchases', id);
    queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${BASE}api/purchases/${deleteConfirm.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash'] });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/expenses'] });
      setDeleteConfirm(null);
      toast({ title: 'Purchase deleted' });
    } catch (e: any) {
      toast({ title: 'Failed to delete purchase', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Purchases" description="Record inward inventory and vendor bills">
        {canCreate && <Button onClick={openCreate}><Plus size={18}/> New Purchase</Button>}
      </PageHeader>

      <DateFilter fromDate={fromDate} toDate={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t); }} />

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">PO Number</th>
              <th className="px-6 py-4">Vendor</th>
              <th className="px-6 py-4">Invoice No</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-right">Total Amount</th>
              <th className="px-6 py-4 text-center">Verified</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">Loading purchases...</td></tr>
            ) : purchases?.length === 0 ? (
               <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">No purchases recorded yet.</td></tr>
            ) : purchasesPagination.paginatedRows.map((p: any) => (
              <tr key={p.id} className="table-row-hover">
                <td className="px-6 py-4 text-foreground font-medium">{formatDate(p.purchaseDate)}</td>
                <td className="px-6 py-4 text-muted-foreground">{p.purchaseNumber}</td>
                <td className="px-6 py-4">{p.vendorName}</td>
                <td className="px-6 py-4 text-muted-foreground">{p.invoiceNumber || '-'}</td>
                <td className="px-6 py-4 text-center">
                  <Badge variant={(p.paymentStatus === 'fully_paid' || p.paymentStatus === 'paid' || p.paymentStatus === 'PAID') ? 'success' : 'warning'}>
                    {p.paymentStatus === 'fully_paid' ? 'Paid' : p.paymentStatus === 'unpaid' ? 'Unpaid' : String(p.paymentStatus || '').replace(/_/g, ' ')}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-right font-medium text-foreground">{formatCurrency(p.totalAmount)}</td>
                <td className="px-6 py-4 text-center">
                  <VerifyButton verified={!!p.verified} isAdmin={isAdmin} onVerify={() => handleVerify(p.id)} onUnverify={() => handleUnverify(p.id)} />
                </td>
                <td className="px-6 py-4">
                  <div className="flex justify-end gap-1">
                    {canEdit && (
                      <button
                        onClick={() => openEdit(p.id)}
                        className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={p.verified && !isAdmin ? 'Verified purchases can only be edited by admin' : 'Edit'}
                        disabled={p.verified && !isAdmin}
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => setDeleteConfirm(p)}
                        className="p-2 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={p.verified && !isAdmin ? 'Verified purchases can only be deleted by admin' : 'Delete'}
                        disabled={p.verified && !isAdmin}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <TablePagination {...purchasesPagination} onPageChange={purchasesPagination.setPage} />
      </div>

      <Modal isOpen={isModalOpen} onClose={closeModal} dirty={purchaseFormDirty} title={editingPurchaseId ? "Edit Purchase" : "Record New Purchase"} maxWidth="max-w-4xl"
        footer={(close) => <><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={handleSave} disabled={createMut.isPending || isSavingEdit || lines.length === 0 || isPurchaseDetailLoading || insufficientPettyCash}>{editingPurchaseId ? 'Update Purchase' : 'Complete Purchase'}</Button></>}>
        <div className="space-y-6 py-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-transparent rounded-xl border border-border/50">
            <div>
              <Label>Vendor</Label>
              <Select value={formData.vendorId} onChange={(e:any) => setFormData({...formData, vendorId: Number(e.target.value)})}>
                <option value={0}>Select Vendor...</option>
                {vendors?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Purchase Date</Label>
              <Input type="date" max={new Date().toISOString().split('T')[0]} value={formData.purchaseDate} onChange={(e:any) => setFormData({...formData, purchaseDate: e.target.value})} />
            </div>
            <div>
              <Label>Invoice Number (Optional)</Label>
              <Input value={formData.invoiceNumber} onChange={(e:any) => setFormData({...formData, invoiceNumber: e.target.value})} placeholder="INV-12345" />
            </div>
          </div>

          <div className="p-4 bg-transparent rounded-xl border border-border/50 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={formData.isPaid}
                onChange={(e:any) => setFormData({...formData, isPaid: e.target.checked})}
                className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
              />
              <span className="text-sm font-medium text-foreground">Paid at the time of purchase</span>
              <span className="text-xs text-muted-foreground">(otherwise tracked as vendor payable)</span>
            </label>
            {formData.isPaid && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <Label>Payment Method</Label>
                  <Select value={formData.paymentMode} onChange={(e:any) => setFormData({...formData, paymentMode: e.target.value})}>
                    <option value="cash">Cash</option>
                    <option value="petty_cash">Petty Cash</option>
                    <option value="account">Bank / Account</option>
                    <option value="upi">UPI</option>
                  </Select>
                  {formData.paymentMode === 'petty_cash' && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        Available Petty Cash Balance: <span className="font-semibold text-foreground">{formatCurrency(availablePettyCashBalance)}</span>
                      </p>
                      {insufficientPettyCash && (
                        <p className="text-xs text-destructive">
                          Insufficient petty cash balance. Available: {formatCurrency(availablePettyCashBalance)}. Required: {formatCurrency(purchaseTotal)}.
                        </p>
                      )}
                    </div>
                  )}
                  {formData.paymentMode === 'petty_cash' && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      ⚠ The purchase total will be deducted from the petty cash balance.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between items-end mb-3">
              <h3 className="font-semibold text-foreground">
                Items Received <span className="text-muted-foreground font-normal">({lines.length})</span>
              </h3>
              <Button variant="outline" size="sm" onClick={addLine}><Plus size={14}/> Add Row</Button>
            </div>
            
            <div className="space-y-2">
              <div className="flex gap-3 px-3 py-2 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide tracking-wider">
                <div className="flex-1">Ingredient</div>
                <div className="w-20 text-right">Qty</div>
                <div className="w-28 text-right">Rate ($)</div>
                <div className="w-20 text-right">Tax (%)</div>
                <div className="w-36">Expiry</div>
                <div className="w-28 text-right">Total</div>
                <div className="w-10"></div>
              </div>
              {editingPurchaseId && isPurchaseDetailLoading && (
                <div className="px-3 py-4 text-sm text-muted-foreground">Loading purchase details...</div>
              )}
              {lines.map((line, idx) => {
                const lineTotal = (line.quantity * line.unitRate) * (1 + line.taxPercent/100);
                return (
                  <div key={idx} className="flex items-center gap-3">
                    <div className="flex-1">
                      <Select value={line.ingredientId} onChange={(e:any) => updateLine(idx, 'ingredientId', Number(e.target.value))}>
                        <option value={0}>Select...</option>
                        {ingredients?.map(ing => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                      </Select>
                    </div>
                    <div className="w-20">
                      <Input type="number" value={line.quantity} onChange={(e:any) => updateLine(idx, 'quantity', Number(e.target.value))} className="text-right" />
                    </div>
                    <div className="w-28">
                      <Input type="number" step="0.01" value={line.unitRate} onChange={(e:any) => updateLine(idx, 'unitRate', Number(e.target.value))} className="text-right" />
                    </div>
                    <div className="w-20">
                      <Input type="number" value={line.taxPercent} onChange={(e:any) => updateLine(idx, 'taxPercent', Number(e.target.value))} className="text-right" />
                    </div>
                    <div className="w-36">
                      <Input
                        type="date"
                        min={new Date().toISOString().split('T')[0]}
                        value={line.expiryDate || ''}
                        onChange={(e:any) => updateLine(idx, 'expiryDate', e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="w-28 text-right font-medium px-2 py-2 bg-muted/50 rounded-xl border border-transparent">
                      {formatCurrency(lineTotal)}
                    </div>
                    <button onClick={() => removeLine(idx)} className="p-2 text-muted-foreground hover:text-destructive transition-colors w-10 flex justify-center">
                      <Trash2 size={18} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-border">
            <div className="text-right">
              <p className="text-sm text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Grand Total</p>
              <p className="text-3xl font-display font-bold text-primary">{formatCurrency(purchaseTotal)}</p>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Purchase"
        footer={(close) => <><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}
      >
        <p className="py-2 text-sm text-muted-foreground">
          Delete purchase <span className="font-semibold text-foreground">{deleteConfirm?.purchaseNumber}</span>? This removes its line items too.
        </p>
      </Modal>
    </div>
  );
}
