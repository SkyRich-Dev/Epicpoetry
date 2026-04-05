import React, { useState } from 'react';
import { useGetStockOverview, useSaveStockSnapshot } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Modal, formatCurrency, Badge } from '../components/ui-extras';
import { PackageSearch, AlertCircle, Save } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export default function Inventory() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: stock, isLoading } = useGetStockOverview();
  const saveMut = useSaveStockSnapshot();
  
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState(new Date().toISOString().split('T')[0]);
  const [snapshotLines, setSnapshotLines] = useState<Record<number, number>>({});

  const openSnapshot = () => {
    const initial: Record<number, number> = {};
    stock?.forEach(s => { initial[s.ingredientId] = s.currentStock; });
    setSnapshotLines(initial);
    setIsSnapshotOpen(true);
  };

  const handleSaveSnapshot = async () => {
    try {
      const items = Object.entries(snapshotLines).map(([id, qty]) => ({
        ingredientId: Number(id),
        closingQty: qty
      }));
      await saveMut.mutateAsync({ data: { snapshotDate, items } });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/stock-overview'] });
      setIsSnapshotOpen(false);
      toast({ title: 'Stock snapshot saved' });
    } catch(e: any) { toast({ title: 'Failed to save snapshot', description: e.message, variant: 'destructive' }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory Overview" description="Real-time theoretical stock levels based on purchases and sales">
        <Button onClick={openSnapshot}><PackageSearch size={18}/> End of Day Count</Button>
      </PageHeader>

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Ingredient</th>
              <th className="px-6 py-4 text-right">Current Stock</th>
              <th className="px-6 py-4">UOM</th>
              <th className="px-6 py-4 text-right">Reorder Lvl</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-right">Stock Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading stock...</td></tr>
            ) : stock?.length === 0 ? (
               <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No ingredients found.</td></tr>
            ) : stock?.map(s => (
              <tr key={s.ingredientId} className="table-row-hover">
                <td className="px-6 py-4 font-medium text-foreground">{s.ingredientName}</td>
                <td className="px-6 py-4 text-right font-display font-semibold text-base">{s.currentStock.toFixed(2)}</td>
                <td className="px-6 py-4 text-muted-foreground">{s.stockUom}</td>
                <td className="px-6 py-4 text-right text-muted-foreground">{s.reorderLevel}</td>
                <td className="px-6 py-4 text-center">
                  {s.lowStock ? (
                    <Badge variant="danger" className="gap-1"><AlertCircle size={12}/> Low Stock</Badge>
                  ) : (
                    <Badge variant="success">Optimal</Badge>
                  )}
                </td>
                <td className="px-6 py-4 text-right text-muted-foreground">{formatCurrency(s.stockValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isSnapshotOpen} onClose={() => setIsSnapshotOpen(false)} title="End of Day Physical Count" maxWidth="max-w-2xl"
        footer={<><Button variant="ghost" onClick={() => setIsSnapshotOpen(false)}>Cancel</Button><Button onClick={handleSaveSnapshot} disabled={saveMut.isPending}><Save size={16}/> Save Count</Button></>}>
        <div className="space-y-6 py-2">
          <div className="bg-transparent p-4 rounded-xl border border-border flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-foreground">Snapshot Date</h4>
              <p className="text-xs text-muted-foreground">Record the actual physical stock to adjust theoretical values.</p>
            </div>
            <Input type="date" max={new Date().toISOString().split('T')[0]} className="w-auto" value={snapshotDate} onChange={(e:any) => setSnapshotDate(e.target.value)} />
          </div>

          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
            {stock?.map(s => (
              <div key={s.ingredientId} className="flex items-center justify-between p-3 border border-border/50 rounded-xl bg-card">
                <div className="flex-1">
                  <p className="font-medium text-foreground">{s.ingredientName}</p>
                  <p className="text-xs text-muted-foreground">Theoretical: {s.currentStock.toFixed(2)} {s.stockUom}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Input 
                    type="number" 
                    step="0.01"
                    className="w-32 text-right"
                    value={snapshotLines[s.ingredientId] ?? ''} 
                    onChange={(e:any) => setSnapshotLines({...snapshotLines, [s.ingredientId]: Number(e.target.value)})}
                  />
                  <span className="text-sm text-muted-foreground w-8">{s.stockUom}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
