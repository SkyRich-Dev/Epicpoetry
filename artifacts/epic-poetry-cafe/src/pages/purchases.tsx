import React, { useState } from 'react';
import { useListPurchases, useCreatePurchase, useListVendors, useListIngredients } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, Badge, formatDate, DateFilter, VerifyButton, apiVerify, apiUnverify } from '../components/ui-extras';
import { Plus, Receipt, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';

export default function Purchases() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const dateParams = { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  const { data: purchases, isLoading } = useListPurchases(Object.keys(dateParams).length ? dateParams : undefined);
  const { data: vendors } = useListVendors();
  const { data: ingredients } = useListIngredients();
  
  const { toast } = useToast();
  const createMut = useCreatePurchase();
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [formData, setFormData] = useState({ 
    purchaseDate: new Date().toISOString().split('T')[0], 
    vendorId: 0, 
    invoiceNumber: '', 
    paymentMode: 'CASH',
    paymentStatus: 'PAID'
  });
  
  const [lines, setLines] = useState<any[]>([]);

  const openCreate = () => {
    setFormData({ purchaseDate: new Date().toISOString().split('T')[0], vendorId: vendors?.[0]?.id || 0, invoiceNumber: '', paymentMode: 'CASH', paymentStatus: 'PAID' });
    setLines([{ ingredientId: 0, quantity: 1, unitRate: 0, taxPercent: 0 }]);
    setIsModalOpen(true);
  };

  const addLine = () => setLines([...lines, { ingredientId: 0, quantity: 1, unitRate: 0, taxPercent: 0 }]);
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

  const handleSave = async () => {
    if (!formData.vendorId) { toast({ title: 'Please select a vendor', variant: 'destructive' }); return; }
    const validLines = lines.filter(l => l.ingredientId > 0 && l.quantity > 0);
    if (validLines.length === 0) { toast({ title: 'Add at least one item with quantity', variant: 'destructive' }); return; }
    try {
      const payload = { ...formData, lines: validLines };
      await createMut.mutateAsync({ data: payload as any });
      queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
      setIsModalOpen(false);
      toast({ title: 'Purchase recorded' });
    } catch (e: any) { toast({ title: 'Failed to save purchase', description: e.message, variant: 'destructive' }); }
  };

  const handleVerify = async (id: number) => {
    await apiVerify('purchases', id);
    queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
  };
  const handleUnverify = async (id: number) => {
    await apiUnverify('purchases', id);
    queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Purchases" description="Record inward inventory and vendor bills">
        {!isViewer && <Button onClick={openCreate}><Plus size={18}/> New Purchase</Button>}
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
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading purchases...</td></tr>
            ) : purchases?.length === 0 ? (
               <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No purchases recorded yet.</td></tr>
            ) : purchases?.map((p: any) => (
              <tr key={p.id} className="table-row-hover">
                <td className="px-6 py-4 text-foreground font-medium">{formatDate(p.purchaseDate)}</td>
                <td className="px-6 py-4 text-muted-foreground">{p.purchaseNumber}</td>
                <td className="px-6 py-4">{p.vendorName}</td>
                <td className="px-6 py-4 text-muted-foreground">{p.invoiceNumber || '-'}</td>
                <td className="px-6 py-4 text-center">
                  <Badge variant={p.paymentStatus === 'PAID' ? 'success' : 'warning'}>{p.paymentStatus}</Badge>
                </td>
                <td className="px-6 py-4 text-right font-medium text-foreground">{formatCurrency(p.totalAmount)}</td>
                <td className="px-6 py-4 text-center">
                  <VerifyButton verified={!!p.verified} isAdmin={isAdmin} onVerify={() => handleVerify(p.id)} onUnverify={() => handleUnverify(p.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Record New Purchase" maxWidth="max-w-4xl"
        footer={<><Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={createMut.isPending || lines.length === 0}>Complete Purchase</Button></>}>
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

          <div>
            <div className="flex justify-between items-end mb-3">
              <h3 className="font-semibold text-foreground">Items Received</h3>
              <Button variant="outline" size="sm" onClick={addLine}><Plus size={14}/> Add Row</Button>
            </div>
            
            <div className="space-y-2">
              <div className="flex gap-3 px-3 py-2 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide tracking-wider">
                <div className="flex-1">Ingredient</div>
                <div className="w-24 text-right">Qty</div>
                <div className="w-32 text-right">Rate ($)</div>
                <div className="w-24 text-right">Tax (%)</div>
                <div className="w-32 text-right">Total</div>
                <div className="w-10"></div>
              </div>
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
                    <div className="w-24">
                      <Input type="number" value={line.quantity} onChange={(e:any) => updateLine(idx, 'quantity', Number(e.target.value))} className="text-right" />
                    </div>
                    <div className="w-32">
                      <Input type="number" step="0.01" value={line.unitRate} onChange={(e:any) => updateLine(idx, 'unitRate', Number(e.target.value))} className="text-right" />
                    </div>
                    <div className="w-24">
                      <Input type="number" value={line.taxPercent} onChange={(e:any) => updateLine(idx, 'taxPercent', Number(e.target.value))} className="text-right" />
                    </div>
                    <div className="w-32 text-right font-medium px-2 py-2 bg-muted/50 rounded-xl border border-transparent">
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
              <p className="text-3xl font-display font-bold text-primary">{formatCurrency(calcTotal())}</p>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
