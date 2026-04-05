import React, { useState } from 'react';
import { useListTrials, useCreateTrial, useGetTrial, useCreateTrialVersion, useConvertTrialToMenuItem, useUpdateTrial, useDeleteTrial } from '@workspace/api-client-react';
import type { TrialVersion, TrialIngredientLine } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Modal, Badge, Select, formatCurrency } from '../components/ui-extras';
import { FlaskConical, Plus, ArrowLeft, Clock, Beaker, ChevronRight, Trash2, CheckCircle2, Package, IndianRupee, Timer, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

function useIngredients() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const [data, setData] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  React.useEffect(() => {
    if (loaded) return;
    const baseUrl = import.meta.env.BASE_URL || '/';
    const apiBase = `${window.location.origin}${baseUrl}api`.replace(/\/+/g, '/').replace(':/', '://');
    fetch(`${apiBase}/ingredients`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { setData(d); setLoaded(true); }).catch(() => setLoaded(true));
  }, [loaded, token]);
  return data;
}

const STATUS_COLORS: Record<string, 'neutral' | 'success' | 'warning'> = {
  draft: 'neutral', testing: 'warning', approved: 'success', converted: 'success',
};

interface IngredientRow {
  ingredientId: number;
  plannedQty: number;
  actualQty: number;
  uom: string;
  wastageQty: number;
}

const emptyIngRow = (): IngredientRow => ({ ingredientId: 0, plannedQty: 0, actualQty: 0, uom: '', wastageQty: 0 });

export default function Trials() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: trials, isLoading } = useListTrials();
  const createMut = useCreateTrial();
  const updateMut = useUpdateTrial();
  const deleteMut = useDeleteTrial();
  const createVersionMut = useCreateTrialVersion();
  const convertMut = useConvertTrialToMenuItem();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ proposedItemName: '', targetCost: 0, targetSellingPrice: 0, notes: '' });

  const [selectedTrialId, setSelectedTrialId] = useState<number | null>(null);
  const { data: trialDetail, isLoading: detailLoading } = useGetTrial(selectedTrialId!, { query: { enabled: !!selectedTrialId } });

  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [versionForm, setVersionForm] = useState({
    trialDate: new Date().toISOString().split('T')[0],
    batchSize: 1, yieldQty: 1, yieldUom: 'pcs', prepTime: 0,
    tasteScore: 0, appearanceScore: 0, consistencyScore: 0, notes: '',
  });
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([emptyIngRow()]);

  const [expandedVersionId, setExpandedVersionId] = useState<number | null>(null);

  const ingredients = useIngredients();

  const handleCreateTrial = async () => {
    if (!formData.proposedItemName.trim()) { toast({ title: 'Item name is required', variant: 'destructive' }); return; }
    try {
      await createMut.mutateAsync({ data: formData as any });
      queryClient.invalidateQueries({ queryKey: ['/api/trials'] });
      setIsModalOpen(false);
      setFormData({ proposedItemName: '', targetCost: 0, targetSellingPrice: 0, notes: '' });
      toast({ title: 'Trial created' });
    } catch (e: any) { toast({ title: 'Failed', description: e.message, variant: 'destructive' }); }
  };

  const handleDeleteTrial = async (id: number) => {
    if (!confirm('Delete this trial and all its versions?')) return;
    try {
      await deleteMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ['/api/trials'] });
      setSelectedTrialId(null);
      toast({ title: 'Trial deleted' });
    } catch (e: any) { toast({ title: 'Failed', description: e.message, variant: 'destructive' }); }
  };

  const openVersionModal = () => {
    setVersionForm({
      trialDate: new Date().toISOString().split('T')[0],
      batchSize: 1, yieldQty: 1, yieldUom: 'pcs', prepTime: 0,
      tasteScore: 0, appearanceScore: 0, consistencyScore: 0, notes: '',
    });
    setIngredientRows([emptyIngRow()]);
    setIsVersionModalOpen(true);
  };

  const handleCreateVersion = async () => {
    const validLines = ingredientRows.filter(r => r.ingredientId > 0 && r.actualQty > 0);
    if (validLines.length === 0) { toast({ title: 'Add at least one ingredient', variant: 'destructive' }); return; }
    if (versionForm.batchSize <= 0) { toast({ title: 'Batch size must be > 0', variant: 'destructive' }); return; }
    if (versionForm.yieldQty <= 0) { toast({ title: 'Yield must be > 0', variant: 'destructive' }); return; }

    try {
      await createVersionMut.mutateAsync({
        id: selectedTrialId!,
        data: {
          ...versionForm,
          ingredients: validLines,
        },
      });
      queryClient.invalidateQueries({ queryKey: [`/api/trials/${selectedTrialId}`] });
      setIsVersionModalOpen(false);
      toast({ title: 'Version created — inventory deducted' });
    } catch (e: any) { toast({ title: 'Failed', description: e.message, variant: 'destructive' }); }
  };

  const handleConvert = async (versionId: number) => {
    if (!confirm('Convert this version to a menu item? This will create a new menu item with recipe.')) return;
    try {
      await convertMut.mutateAsync({ trialId: selectedTrialId!, versionId });
      queryClient.invalidateQueries({ queryKey: ['/api/trials'] });
      queryClient.invalidateQueries({ queryKey: [`/api/trials/${selectedTrialId}`] });
      toast({ title: 'Converted to menu item!' });
    } catch (e: any) { toast({ title: 'Failed', description: e.message, variant: 'destructive' }); }
  };

  const addIngRow = () => setIngredientRows(prev => [...prev, emptyIngRow()]);
  const removeIngRow = (idx: number) => setIngredientRows(prev => prev.filter((_, i) => i !== idx));
  const updateIngRow = (idx: number, field: keyof IngredientRow, value: any) => {
    setIngredientRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: value };
      if (field === 'ingredientId' && value > 0) {
        const ing = ingredients.find((ig: any) => ig.id === value);
        if (ing) updated.uom = ing.recipeUom || ing.stockUom || 'unit';
      }
      return updated;
    }));
  };

  const getIngName = (id: number) => ingredients.find((i: any) => i.id === id)?.name || `#${id}`;
  const getIngUom = (id: number) => {
    const ing = ingredients.find((i: any) => i.id === id);
    return ing?.recipeUom || ing?.stockUom || 'unit';
  };

  if (selectedTrialId && trialDetail) {
    const trial = trialDetail.trial;
    const versions = trialDetail.versions || [];
    const totalRnDExpense = versions.reduce((s, v) => s + v.totalCost, 0);
    const totalTime = versions.reduce((s, v) => s + (v.prepTime || 0), 0);

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => setSelectedTrialId(null)} className="h-9 w-9 p-0">
            <ArrowLeft size={18} />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="font-display font-bold text-2xl">{trial.proposedItemName}</h1>
              <Badge variant={STATUS_COLORS[trial.status] || 'neutral'}>{trial.status.toUpperCase()}</Badge>
            </div>
            <p className="text-sm text-muted-foreground font-mono">{trial.trialCode}</p>
          </div>
          <Button onClick={openVersionModal}><Plus size={18} /> New Version</Button>
          <Button variant="danger" onClick={() => handleDeleteTrial(trial.id)} className="h-9 w-9 p-0"><Trash2 size={16} /></Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border/50 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><IndianRupee size={14} /> Target Cost</div>
            <p className="text-lg font-bold font-numbers">{formatCurrency(Number(trial.targetCost || 0))}</p>
          </div>
          <div className="bg-card border border-border/50 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><IndianRupee size={14} /> Target Price</div>
            <p className="text-lg font-bold font-numbers">{formatCurrency(Number(trial.targetSellingPrice || 0))}</p>
          </div>
          <div className="bg-card border border-border/50 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Beaker size={14} /> R&D Expense</div>
            <p className="text-lg font-bold font-numbers text-red-600">{formatCurrency(totalRnDExpense)}</p>
          </div>
          <div className="bg-card border border-border/50 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Timer size={14} /> Total R&D Time</div>
            <p className="text-lg font-bold font-numbers">{totalTime} min</p>
          </div>
        </div>

        <div className="space-y-5">
          <h2 className="font-semibold text-lg">Versions ({versions.length})</h2>
          {versions.length === 0 ? (
            <div className="bg-card border border-dashed border-border rounded-2xl p-12 text-center">
              <Beaker size={40} className="mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No versions yet. Create your first R&D version to start tracking.</p>
            </div>
          ) : (
            versions.map(v => (
              <VersionCard
                key={v.id}
                version={v}
                expanded={expandedVersionId === v.id}
                onToggle={() => setExpandedVersionId(expandedVersionId === v.id ? null : v.id)}
                onConvert={() => handleConvert(v.id)}
                trialStatus={trial.status}
                getIngName={getIngName}
              />
            ))
          )}
        </div>

        <Modal isOpen={isVersionModalOpen} onClose={() => setIsVersionModalOpen(false)} title="New R&D Version" maxWidth="max-w-2xl"
          footer={<><Button variant="ghost" onClick={() => setIsVersionModalOpen(false)}>Cancel</Button><Button onClick={handleCreateVersion} disabled={createVersionMut.isPending}>{createVersionMut.isPending ? 'Creating...' : 'Create Version & Deduct Stock'}</Button></>}>
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
              <div><Label>Trial Date</Label><Input type="date" value={versionForm.trialDate} onChange={e => setVersionForm({ ...versionForm, trialDate: e.target.value })} /></div>
              <div><Label>Batch Size</Label><Input type="number" step="0.1" value={versionForm.batchSize} onChange={e => setVersionForm({ ...versionForm, batchSize: Number(e.target.value) })} /></div>
              <div><Label>Prep Time (min)</Label><Input type="number" value={versionForm.prepTime} onChange={e => setVersionForm({ ...versionForm, prepTime: Number(e.target.value) })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
              <div><Label>Yield Qty</Label><Input type="number" step="0.1" value={versionForm.yieldQty} onChange={e => setVersionForm({ ...versionForm, yieldQty: Number(e.target.value) })} /></div>
              <div><Label>Yield UOM</Label>
                <Select value={versionForm.yieldUom} onChange={e => setVersionForm({ ...versionForm, yieldUom: e.target.value })}>
                  <option value="pcs">Pieces</option>
                  <option value="cups">Cups</option>
                  <option value="servings">Servings</option>
                  <option value="kg">Kg</option>
                  <option value="L">Litres</option>
                </Select>
              </div>
              <div></div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-sm font-semibold">Ingredients Used</Label>
                <Button variant="ghost" onClick={addIngRow} className="h-7 text-xs"><Plus size={14} /> Add</Button>
              </div>
              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left">Ingredient</th>
                      <th className="px-3 py-2 text-left w-20">Planned</th>
                      <th className="px-3 py-2 text-left w-20">Actual</th>
                      <th className="px-3 py-2 text-left w-20">Waste</th>
                      <th className="px-3 py-2 text-left w-16">UOM</th>
                      <th className="px-3 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {ingredientRows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-1.5">
                          <Select value={row.ingredientId} onChange={e => updateIngRow(idx, 'ingredientId', Number(e.target.value))}>
                            <option value={0}>Select...</option>
                            {ingredients.map((ing: any) => (
                              <option key={ing.id} value={ing.id}>{ing.name} ({ing.currentStock} {ing.stockUom})</option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-3 py-1.5"><Input type="number" step="0.1" className="h-8" value={row.plannedQty || ''} onChange={e => updateIngRow(idx, 'plannedQty', Number(e.target.value))} /></td>
                        <td className="px-3 py-1.5"><Input type="number" step="0.1" className="h-8" value={row.actualQty || ''} onChange={e => updateIngRow(idx, 'actualQty', Number(e.target.value))} /></td>
                        <td className="px-3 py-1.5"><Input type="number" step="0.1" className="h-8" value={row.wastageQty || ''} onChange={e => updateIngRow(idx, 'wastageQty', Number(e.target.value))} /></td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{row.ingredientId > 0 ? getIngUom(row.ingredientId) : '-'}</td>
                        <td className="px-2 py-1.5">
                          {ingredientRows.length > 1 && (
                            <button onClick={() => removeIngRow(idx)} className="text-red-500 hover:text-red-700"><XCircle size={16} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Stock will be deducted based on actual qty + wastage</p>
            </div>

            <div>
              <Label className="text-sm font-semibold mb-2 block">Quality Scores (0-10)</Label>
              <div className="grid grid-cols-3 gap-x-4 gap-y-5">
                <div><Label className="text-xs">Taste</Label><Input type="number" min="0" max="10" step="0.5" value={versionForm.tasteScore} onChange={e => setVersionForm({ ...versionForm, tasteScore: Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Appearance</Label><Input type="number" min="0" max="10" step="0.5" value={versionForm.appearanceScore} onChange={e => setVersionForm({ ...versionForm, appearanceScore: Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Consistency</Label><Input type="number" min="0" max="10" step="0.5" value={versionForm.consistencyScore} onChange={e => setVersionForm({ ...versionForm, consistencyScore: Number(e.target.value) })} /></div>
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" rows={2}
                value={versionForm.notes} onChange={e => setVersionForm({ ...versionForm, notes: e.target.value })} />
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Trials & R&D" description="Experiment with new recipes, track ingredient usage, and analyze test batches">
        <Button onClick={() => setIsModalOpen(true)}><Plus size={18} /> New Trial</Button>
      </PageHeader>

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        trials && trials.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {trials.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedTrialId(t.id)}
                className="bg-card border border-border rounded-2xl p-6 hover:shadow-md transition-all text-left relative overflow-hidden group"
              >
                <div className="absolute -right-6 -top-6 text-primary/5 group-hover:text-primary/10 transition-colors">
                  <FlaskConical size={100} />
                </div>
                <div className="flex justify-between items-start mb-2 relative z-10">
                  <h3 className="font-display font-bold text-xl">{t.proposedItemName}</h3>
                  <Badge variant={STATUS_COLORS[t.status] || 'neutral'}>{t.status.toUpperCase()}</Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono mb-6 relative z-10">{t.trialCode}</p>
                <div className="space-y-2 relative z-10">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Target Cost:</span>
                    <span className="font-medium font-numbers">{formatCurrency(Number(t.targetCost || 0))}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Target Price:</span>
                    <span className="font-medium font-numbers">{formatCurrency(Number(t.targetSellingPrice || 0))}</span>
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between text-xs text-primary relative z-10">
                  <span>View Versions & Details</span>
                  <ChevronRight size={16} />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-card border border-dashed border-border rounded-2xl p-16 text-center">
            <FlaskConical size={48} className="mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No Trials Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Start your first R&D experiment to track ingredient usage, costs, and versions.</p>
            <Button onClick={() => setIsModalOpen(true)}><Plus size={18} /> New Trial</Button>
          </div>
        )
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Initiate New Trial" maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button onClick={handleCreateTrial} disabled={createMut.isPending}>Create Trial</Button></>}>
        <div className="space-y-5 py-2">
          <div><Label>Proposed Item Name</Label><Input value={formData.proposedItemName} onChange={(e: any) => setFormData({ ...formData, proposedItemName: e.target.value })} placeholder="e.g. Matcha Latte, Cold Brew Tonic" /></div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Target Cost</Label><Input type="number" step="0.01" value={formData.targetCost || ''} onChange={(e: any) => setFormData({ ...formData, targetCost: Number(e.target.value) })} /></div>
            <div><Label>Target Selling Price</Label><Input type="number" step="0.01" value={formData.targetSellingPrice || ''} onChange={(e: any) => setFormData({ ...formData, targetSellingPrice: Number(e.target.value) })} /></div>
          </div>
          <div><Label>Notes</Label>
            <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" rows={2}
              value={formData.notes} onChange={(e: any) => setFormData({ ...formData, notes: e.target.value })} placeholder="Recipe idea, inspiration, goals..." />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function VersionCard({ version, expanded, onToggle, onConvert, trialStatus, getIngName }: {
  version: TrialVersion; expanded: boolean; onToggle: () => void;
  onConvert: () => void; trialStatus: string; getIngName: (id: number) => string;
}) {
  const avgScore = [version.tasteScore, version.appearanceScore, version.consistencyScore]
    .filter(s => s != null && s > 0);
  const avgScoreVal = avgScore.length > 0 ? avgScore.reduce((a, b) => a + (b || 0), 0) / avgScore.length : 0;

  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <button onClick={onToggle} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-muted/30 transition-colors text-left">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
          V{version.versionNumber}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Version {version.versionNumber}</span>
            {version.trialDate && <span className="text-xs text-muted-foreground">{version.trialDate}</span>}
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground mt-0.5">
            <span>Cost: <span className="font-numbers font-medium text-foreground">{formatCurrency(version.totalCost)}</span></span>
            <span>Per unit: <span className="font-numbers font-medium text-foreground">{formatCurrency(version.costPerUnit)}</span></span>
            {version.prepTime ? <span className="flex items-center gap-1"><Clock size={12} /> {version.prepTime} min</span> : null}
            {avgScoreVal > 0 && <span>Score: <span className="font-medium text-foreground">{avgScoreVal.toFixed(1)}/10</span></span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {version.inventoryDeducted ? (
            <span className="text-xs text-green-600 flex items-center gap-1"><Package size={12} /> Stock Deducted</span>
          ) : null}
          <ChevronRight size={18} className={`text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-6 py-4 space-y-4 bg-muted/10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InfoBlock label="Trial Date" value={version.trialDate || '-'} />
            <InfoBlock label="Batch Size" value={String(version.batchSize)} />
            <InfoBlock label="Yield" value={`${version.yieldQty} ${version.yieldUom}`} />
            <InfoBlock label="Prep Time" value={version.prepTime ? `${version.prepTime} min` : '-'} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <InfoBlock label="Taste Score" value={version.tasteScore != null ? `${version.tasteScore}/10` : '-'} />
            <InfoBlock label="Appearance" value={version.appearanceScore != null ? `${version.appearanceScore}/10` : '-'} />
            <InfoBlock label="Consistency" value={version.consistencyScore != null ? `${version.consistencyScore}/10` : '-'} />
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">Ingredients Used</h4>
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left">Ingredient</th>
                    <th className="px-4 py-2 text-right">Planned</th>
                    <th className="px-4 py-2 text-right">Actual</th>
                    <th className="px-4 py-2 text-right">Wastage</th>
                    <th className="px-4 py-2 text-left">UOM</th>
                    <th className="px-4 py-2 text-right">Rate</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {(version.ingredients || []).map((ing, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-2 font-medium">{ing.ingredientName || getIngName(ing.ingredientId)}</td>
                      <td className="px-4 py-2 text-right font-numbers">{ing.plannedQty}</td>
                      <td className="px-4 py-2 text-right font-numbers">{ing.actualQty}</td>
                      <td className="px-4 py-2 text-right font-numbers">{ing.wastageQty || 0}</td>
                      <td className="px-4 py-2">{ing.uom}</td>
                      <td className="px-4 py-2 text-right font-numbers">{formatCurrency(ing.costPerUnit || 0)}</td>
                      <td className="px-4 py-2 text-right font-numbers font-medium">{formatCurrency(ing.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/50">
                  <tr>
                    <td colSpan={6} className="px-4 py-2 text-right font-semibold text-sm">Total R&D Cost:</td>
                    <td className="px-4 py-2 text-right font-numbers font-bold text-sm">{formatCurrency(version.totalCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {version.notes && (
            <div className="text-sm">
              <span className="font-semibold">Notes:</span>
              <span className="text-muted-foreground ml-2">{version.notes}</span>
            </div>
          )}

          {trialStatus !== 'approved' && trialStatus !== 'converted' && (
            <div className="flex justify-end pt-2">
              <Button onClick={onConvert} className="bg-green-600 hover:bg-green-700 text-white">
                <CheckCircle2 size={16} /> Convert to Menu Item
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background rounded-lg px-3 py-2 border border-border/30">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
}
