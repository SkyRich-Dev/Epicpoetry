import React, { useState } from 'react';
import { useListTrials, useCreateTrial } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Modal, Badge, formatCurrency } from '../components/ui-extras';
import { FlaskConical, Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export default function Trials() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: trials, isLoading } = useListTrials();
  const createMut = useCreateTrial();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ proposedItemName: '', targetCost: 0, targetSellingPrice: 0 });

  const handleSave = async () => {
    if (!formData.proposedItemName.trim()) { toast({ title: 'Item name is required', variant: 'destructive' }); return; }
    try {
      await createMut.mutateAsync({ data: formData as any });
      queryClient.invalidateQueries({ queryKey: ['/api/trials'] });
      setIsModalOpen(false);
      toast({ title: 'Trial created' });
    } catch(e: any) { toast({ title: 'Failed to create trial', description: e.message, variant: 'destructive' }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Trials & R&D" description="Experiment with new recipes and analyze test batches">
        <Button onClick={() => setIsModalOpen(true)}><Plus size={18}/> New Trial</Button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? <p>Loading...</p> : trials?.map(t => (
          <div key={t.id} className="bg-card border border-border rounded-2xl p-6 hover:shadow-md transition-shadow relative overflow-hidden group">
            <div className="absolute -right-6 -top-6 text-primary/5 group-hover:text-primary/10 transition-colors">
              <FlaskConical size={100} />
            </div>
            <div className="flex justify-between items-start mb-2 relative z-10">
               <h3 className="font-display font-bold text-xl">{t.proposedItemName}</h3>
               <Badge variant={t.status === 'APPROVED' ? 'success' : 'neutral'}>{t.status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground font-mono mb-6 relative z-10">{t.trialCode}</p>
            
            <div className="space-y-2 relative z-10">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Target Cost:</span>
                <span className="font-medium">{formatCurrency(Number(t.targetCost))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Target Price:</span>
                <span className="font-medium">{formatCurrency(Number(t.targetSellingPrice))}</span>
              </div>
            </div>
            <div className="mt-6 relative z-10">
              <Button variant="outline" className="w-full h-9">View Versions</Button>
            </div>
          </div>
        ))}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Initiate Trial" maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={createMut.isPending}>Create Trial</Button></>}>
        <div className="space-y-4 py-2">
          <div><Label>Proposed Item Name</Label><Input value={formData.proposedItemName} onChange={(e:any) => setFormData({...formData, proposedItemName: e.target.value})} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Target Cost ($)</Label><Input type="number" step="0.01" value={formData.targetCost} onChange={(e:any) => setFormData({...formData, targetCost: Number(e.target.value)})} /></div>
            <div><Label>Target Selling Price ($)</Label><Input type="number" step="0.01" value={formData.targetSellingPrice} onChange={(e:any) => setFormData({...formData, targetSellingPrice: Number(e.target.value)})} /></div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
