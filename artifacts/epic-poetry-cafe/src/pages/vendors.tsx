import React, { useState, useEffect, useCallback } from 'react';
import { useListVendors, useCreateVendor } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Modal, Badge, formatCurrency } from '../components/ui-extras';
import { Plus, Phone, Mail, Pencil, Trash2, Eye, AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

const BASE = import.meta.env.BASE_URL || '/';
async function apiFetch(path: string) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${BASE}api/${path}`, { headers: { 'Authorization': `Bearer ${token}` } });
  return res.json();
}

const emptyForm = { name: '', contactPerson: '', mobile: '', email: '', gstNumber: '', address: '', paymentTerms: '', creditDays: 0, active: true };

export default function Vendors() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const { data: vendors, isLoading } = useListVendors();
  const createMut = useCreateVendor();
  const [, setLocation] = useLocation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const { toast } = useToast();
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  const [vendorSummaries, setVendorSummaries] = useState<Map<number, any>>(new Map());
  const [filter, setFilter] = useState<'all' | 'withDues' | 'overdue'>('all');

  useEffect(() => {
    if (!vendors?.length) return;
    (async () => {
      try {
        const data = await apiFetch('vendor-summaries');
        const summaries = new Map<number, any>();
        for (const [id, summary] of Object.entries(data)) {
          summaries.set(Number(id), summary);
        }
        setVendorSummaries(summaries);
      } catch (e) { console.error('Failed to load vendor summaries', e); }
    })();
  }, [vendors]);

  const openCreate = () => { setEditId(null); setFormData(emptyForm); setIsModalOpen(true); };
  const openEdit = (v: any) => {
    setEditId(v.id);
    setFormData({ name: v.name, contactPerson: v.contactPerson || '', mobile: v.mobile || '', email: v.email || '', gstNumber: v.gstNumber || '', address: v.address || '', paymentTerms: v.paymentTerms || '', creditDays: v.creditDays || 0, active: v.active ?? true });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) { toast({ title: 'Vendor name is required', variant: 'destructive' }); return; }
    try {
      const token = localStorage.getItem('token');
      if (editId) {
        const res = await fetch(`${BASE}api/vendors/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(formData) });
        if (!res.ok) throw new Error(await res.text());
      } else {
        await createMut.mutateAsync({ data: formData as any });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/vendors'] });
      setIsModalOpen(false);
      toast({ title: editId ? 'Vendor updated' : 'Vendor created' });
    } catch(e: any) { toast({ title: 'Failed to save vendor', description: e.message, variant: 'destructive' }); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${BASE}api/vendors/${deleteConfirm.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: 'Delete failed' })); throw new Error(err.error || 'Delete failed'); }
      queryClient.invalidateQueries({ queryKey: ['/api/vendors'] });
      setDeleteConfirm(null);
      toast({ title: 'Vendor deleted' });
    } catch(e: any) { toast({ title: 'Failed to delete vendor', description: e.message, variant: 'destructive' }); }
  };

  const filteredVendors = vendors?.filter(v => {
    if (filter === 'all') return true;
    const s = vendorSummaries.get(v.id);
    if (!s) return false;
    if (filter === 'withDues') return s.totalPending > 0;
    if (filter === 'overdue') return s.overdueBillsCount > 0;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Vendors" description="Manage suppliers, purchases, and payments">
        {!isViewer && <Button onClick={openCreate}><Plus size={18}/> Add Vendor</Button>}
      </PageHeader>

      <div className="flex gap-2 flex-wrap">
        {['all', 'withDues', 'overdue'].map(f => (
          <button key={f} onClick={() => setFilter(f as any)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
            {f === 'all' ? 'All Vendors' : f === 'withDues' ? 'With Dues' : 'Overdue'}
          </button>
        ))}
      </div>

      <div className="bg-card rounded-xl border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Vendor</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Contact</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Total Purchase</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Paid</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Pending</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Overdue</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Actions</th>
          </tr></thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : filteredVendors?.map(v => {
              const s = vendorSummaries.get(v.id);
              return (
                <tr key={v.id} className="border-b hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setLocation(`/vendors/${v.id}`)}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{v.name}</div>
                    <div className="text-xs text-muted-foreground">{v.code}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="text-sm">{v.contactPerson || '-'}</div>
                    {v.mobile && <div className="text-xs">{v.mobile}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-numbers">{s ? formatCurrency(s.totalPurchase) : '-'}</td>
                  <td className="px-4 py-3 text-right font-numbers text-emerald-600">{s ? formatCurrency(s.totalPaid) : '-'}</td>
                  <td className="px-4 py-3 text-right font-numbers text-amber-600">{s && s.totalPending > 0 ? formatCurrency(s.totalPending) : '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {s && s.overdueBillsCount > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        <AlertTriangle size={11} /> {s.overdueBillsCount}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-center"><Badge variant={v.active ? "success" : "neutral"}>{v.active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setLocation(`/vendors/${v.id}`)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="View"><Eye size={14}/></button>
                      {!isViewer && <button onClick={() => openEdit(v)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Pencil size={14}/></button>}
                      {isAdmin && <button onClick={() => setDeleteConfirm({ id: v.id, name: v.name })} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 transition-colors" title="Delete"><Trash2 size={14}/></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editId ? "Edit Vendor" : "Add Vendor"} maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={createMut.isPending}>{editId ? 'Update' : 'Save'}</Button></>}>
        <div className="space-y-4 py-2">
          <div><Label>Company Name</Label><Input value={formData.name} onChange={(e:any) => setFormData({...formData, name: e.target.value})} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Contact Person</Label><Input value={formData.contactPerson} onChange={(e:any) => setFormData({...formData, contactPerson: e.target.value})} /></div>
            <div><Label>GST Number</Label><Input value={formData.gstNumber} onChange={(e:any) => setFormData({...formData, gstNumber: e.target.value})} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Mobile</Label><Input value={formData.mobile} onChange={(e:any) => setFormData({...formData, mobile: e.target.value})} /></div>
            <div><Label>Email</Label><Input type="email" value={formData.email} onChange={(e:any) => setFormData({...formData, email: e.target.value})} /></div>
          </div>
          <div><Label>Address</Label><Input value={formData.address} onChange={(e:any) => setFormData({...formData, address: e.target.value})} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Payment Terms</Label><Input value={formData.paymentTerms} onChange={(e:any) => setFormData({...formData, paymentTerms: e.target.value})} /></div>
            <div><Label>Credit Days</Label><Input type="number" value={formData.creditDays} onChange={(e:any) => setFormData({...formData, creditDays: Number(e.target.value)})} /></div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Vendor"
        footer={<><Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}>
        <p className="py-2 text-sm text-muted-foreground">Are you sure you want to delete <span className="font-semibold text-foreground">{deleteConfirm?.name}</span>? This cannot be undone.</p>
      </Modal>
    </div>
  );
}
