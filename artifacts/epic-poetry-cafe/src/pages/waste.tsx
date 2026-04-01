import React, { useState } from 'react';
import { useListWasteEntries, useCreateWasteEntry, useListIngredients } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, formatDate, Badge, DateFilter } from '../components/ui-extras';
import { Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export default function Waste() {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const dateParams = { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  const { data: waste, isLoading } = useListWasteEntries(Object.keys(dateParams).length ? dateParams : undefined);
  const { data: ingredients } = useListIngredients();
  const createMut = useCreateWasteEntry();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ 
    wasteDate: new Date().toISOString().split('T')[0], 
    wasteType: 'INGREDIENT',
    ingredientId: 0,
    quantity: 1,
    uom: 'g',
    reason: ''
  });

  const handleSave = async () => {
    try {
      await createMut.mutateAsync({ data: formData as any });
      queryClient.invalidateQueries({ queryKey: ['/api/waste'] });
      setIsModalOpen(false);
    } catch(e) { console.error(e); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Waste Log" description="Track spoiled, expired, or damaged items">
        <Button onClick={() => setIsModalOpen(true)} variant="danger"><Trash2 size={18} className="mr-1"/> Log Waste</Button>
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
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : waste?.map(w => (
              <tr key={w.id} className="table-row-hover">
                <td className="px-6 py-4 text-muted-foreground">{formatDate(w.wasteDate)}</td>
                <td className="px-6 py-4 font-medium text-foreground">{w.ingredientName || w.menuItemName} <Badge variant="neutral" className="ml-2 px-1">{w.wasteType}</Badge></td>
                <td className="px-6 py-4 text-muted-foreground">{w.reason}</td>
                <td className="px-6 py-4 text-right">{Number(w.quantity).toFixed(2)} {w.uom}</td>
                <td className="px-6 py-4 text-right font-medium text-rose-600">{formatCurrency(w.costValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Log Waste"
        footer={<><Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button onClick={handleSave} variant="danger" disabled={createMut.isPending}>Confirm Log</Button></>}>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Date</Label><Input type="date" value={formData.wasteDate} onChange={(e:any) => setFormData({...formData, wasteDate: e.target.value})} /></div>
            <div>
              <Label>Waste Type</Label>
              <Select value={formData.wasteType} onChange={(e:any) => setFormData({...formData, wasteType: e.target.value})}>
                <option value="INGREDIENT">Raw Ingredient</option>
                <option value="MENU_ITEM">Prepared Menu Item</option>
              </Select>
            </div>
          </div>
          <div>
            <Label>Item</Label>
            <Select value={formData.ingredientId} onChange={(e:any) => setFormData({...formData, ingredientId: Number(e.target.value)})}>
              <option value={0}>Select Item...</option>
              {ingredients?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Quantity</Label><Input type="number" step="0.01" value={formData.quantity} onChange={(e:any) => setFormData({...formData, quantity: Number(e.target.value)})} /></div>
            <div><Label>UOM</Label><Input value={formData.uom} onChange={(e:any) => setFormData({...formData, uom: e.target.value})} /></div>
          </div>
          <div><Label>Reason</Label><Input value={formData.reason} onChange={(e:any) => setFormData({...formData, reason: e.target.value})} placeholder="e.g. Expired, Spilled" /></div>
        </div>
      </Modal>
    </div>
  );
}
