import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader, Button, Select, Modal, formatDate } from '../components/ui-extras';
import { Link2, Unlink, Trash2, RefreshCw } from 'lucide-react';
import { useListMenuItems } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

const BASE = import.meta.env.BASE_URL || '/';
async function apiFetch(path: string, opts?: any) {
  const token = localStorage.getItem('token');
  const headers: any = { 'Authorization': `Bearer ${token}` };
  if (opts?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}api/${path}`, { ...opts, headers: { ...headers, ...opts?.headers } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function PetpoojaMappingsPage() {
  const { toast } = useToast();
  const { data: menuItems } = useListMenuItems({ active: true });
  const [mappings, setMappings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await apiFetch('petpooja-mappings'); setMappings(data); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleMap = async (id: number, menuItemId: number) => {
    try {
      await apiFetch(`petpooja-mappings/${id}`, { method: 'PATCH', body: JSON.stringify({ menuItemId: menuItemId || null }) });
      toast({ title: menuItemId ? 'Mapped successfully' : 'Mapping cleared' });
      load();
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await apiFetch(`petpooja-mappings/${deleteConfirm.id}`, { method: 'DELETE' });
      toast({ title: 'Deleted' });
      setDeleteConfirm(null);
      load();
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const filtered = mappings.filter(m => {
    if (filter === 'mapped') return !!m.menuItemId;
    if (filter === 'unmapped') return !m.menuItemId;
    return true;
  });

  const unmappedCount = mappings.filter(m => !m.menuItemId).length;
  const mappedCount = mappings.filter(m => !!m.menuItemId).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Petpooja Item Mapping" description="Map Petpooja menu items to your internal menu items for accurate import">
        <Button onClick={load} className="bg-secondary text-secondary-foreground hover:bg-secondary/80"><RefreshCw size={18} /> Refresh</Button>
      </PageHeader>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border p-4"><p className="text-xs text-muted-foreground uppercase">Total Items</p><p className="text-xl font-bold font-numbers">{mappings.length}</p></div>
        <div className="bg-card rounded-xl border p-4"><p className="text-xs text-muted-foreground uppercase">Mapped</p><p className="text-xl font-bold font-numbers text-emerald-600">{mappedCount}</p></div>
        <div className="bg-card rounded-xl border p-4"><p className="text-xs text-muted-foreground uppercase">Unmapped</p><p className="text-xl font-bold font-numbers text-amber-600">{unmappedCount}</p></div>
      </div>

      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {[
          { key: 'all' as const, label: `All (${mappings.length})` },
          { key: 'unmapped' as const, label: `Unmapped (${unmappedCount})` },
          { key: 'mapped' as const, label: `Mapped (${mappedCount})` },
        ].map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${filter === t.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-card rounded-xl border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Petpooja Item</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Petpooja ID</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Map To</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Actions</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No mappings found. Import a Petpooja file to auto-register items.</td></tr>
            ) : filtered.map(m => (
              <tr key={m.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{m.petpoojaItemName}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{m.petpoojaItemId || '-'}</td>
                <td className="px-4 py-3">
                  {m.menuItemId ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700"><Link2 size={11} /> {m.menuItemName}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700"><Unlink size={11} /> Unmapped</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Select value={m.menuItemId || 0} onChange={(e: any) => handleMap(m.id, Number(e.target.value))}>
                    <option value={0}>-- Select Menu Item --</option>
                    {menuItems?.map(mi => <option key={mi.id} value={mi.id}>{mi.name}</option>)}
                  </Select>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setDeleteConfirm(m)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 transition-colors" title="Delete">
                    <Trash2 size={14}/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Mapping"
        footer={<><Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}>
        <p className="py-2 text-sm text-muted-foreground">Remove mapping for <span className="font-semibold text-foreground">{deleteConfirm?.petpoojaItemName}</span>?</p>
      </Modal>
    </div>
  );
}
