import React, { useState, useEffect, useCallback } from 'react';
import { useListCategories, useCreateCategory, useListUom, useGetConfig, useUpdateConfig, useListUsers, useCreateUser, useUpdateUser } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, Badge, formatCurrency, formatDate } from '../components/ui-extras';
import { Settings, Plus, UserPlus, Pencil, Shield, ShieldCheck, Eye, ScrollText, UserCog, FolderCog, Download, Trash2, Plug, Wifi, WifiOff, RefreshCw, Copy, AlertTriangle, CheckCircle2, Trash, Bell, Mail, Send, Play, Power } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { customFetch } from '@workspace/api-client-react/custom-fetch';

const TABS = [
  { id: 'config', label: 'Categories & Config', icon: FolderCog },
  { id: 'users', label: 'User Management', icon: UserCog },
  { id: 'roles', label: 'Roles & Permissions', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'pos', label: 'POS & Integrations', icon: Plug },
  { id: 'audit', label: 'Audit Logs', icon: ScrollText },
] as const;

type ApiRole = {
  id: number;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  permissions: string[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
};

type PermissionDef = { key: string; label: string; description?: string };
type PermissionCategory = { id: string; label: string; permissions: PermissionDef[] };

function useRoles() {
  const [roles, setRoles] = useState<ApiRole[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await customFetch<ApiRole[]>('/api/roles');
      setRoles(data);
    } catch (e) {
      console.error('Failed to load roles', e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { roles, loading, reload };
}

function usePermissionsCatalog() {
  const [catalog, setCatalog] = useState<{ categories: PermissionCategory[]; allKeys: string[] } | null>(null);
  useEffect(() => {
    customFetch<{ categories: PermissionCategory[]; allKeys: string[] }>('/api/permissions')
      .then(setCatalog)
      .catch((e) => console.error('Failed to load permissions catalog', e));
  }, []);
  return catalog;
}

function prettyRoleName(name: string): string {
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

type TabId = typeof TABS[number]['id'];

const DEFAULT_CONFIG = {
  cafeName: 'Platr',
  costingMethod: 'weighted_average',
  currency: 'INR',
  decimalPrecision: 2,
  businessDayCloseTime: '23:00',
  wasteThresholdPercent: 5,
  lowStockAlertDays: 3,
  dailyAllocationMethod: 'equal_daily',
  taxRate: 0,
};

const ROLES = [
  { value: 'admin', label: 'Admin', description: 'Full access to all modules' },
  { value: 'manager', label: 'Manager', description: 'Operations access (Sales, Purchases, Expenses, Inventory, etc.)' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access to all modules' },
];

function RoleBadge({ role }: { role: string }) {
  if (role === 'owner') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-amber-100 text-amber-800"><ShieldCheck size={12} /> Owner</span>;
  if (role === 'admin') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-purple-100 text-purple-700"><ShieldCheck size={12} /> Admin</span>;
  if (role === 'manager') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-700"><Shield size={12} /> Manager</span>;
  if (role === 'accountant') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-700"><Shield size={12} /> Accountant</span>;
  if (role === 'store') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-cyan-100 text-cyan-700"><Shield size={12} /> Store</span>;
  if (role === 'hr') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-pink-100 text-pink-700"><Shield size={12} /> HR</span>;
  if (role === 'viewer') return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700"><Eye size={12} /> Viewer</span>;
  return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-orange-100 text-orange-700"><Shield size={12} /> {prettyRoleName(role)}</span>;
}

function CategoriesConfigTab() {
  const queryClient = useQueryClient();
  const { data: categories } = useListCategories();
  const { data: config } = useGetConfig();
  const createCatMut = useCreateCategory();
  const updateConfigMut = useUpdateConfig();

  const [catModal, setCatModal] = useState(false);
  const [catEditId, setCatEditId] = useState<number | null>(null);
  const [catForm, setCatForm] = useState({ name: '', type: 'ingredient', active: true });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  const [configModal, setConfigModal] = useState(false);
  const [configForm, setConfigForm] = useState(DEFAULT_CONFIG);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setConfigForm({
        cafeName: (config as any).cafeName || 'Platr',
        costingMethod: config.costingMethod || 'weighted_average',
        currency: config.currency || 'INR',
        decimalPrecision: config.decimalPrecision ?? 2,
        businessDayCloseTime: config.businessDayCloseTime || '23:00',
        wasteThresholdPercent: config.wasteThresholdPercent ?? 5,
        lowStockAlertDays: config.lowStockAlertDays ?? 3,
        dailyAllocationMethod: config.dailyAllocationMethod || 'equal_daily',
        taxRate: config.taxRate ?? 0,
      });
    }
  }, [config]);

  const openAddCat = () => {
    setCatEditId(null);
    setCatForm({ name: '', type: 'ingredient', active: true });
    setCatModal(true);
  };

  const openEditCat = (cat: any) => {
    setCatEditId(cat.id);
    setCatForm({ name: cat.name, type: cat.type, active: cat.active ?? true });
    setCatModal(true);
  };

  const handleSaveCat = async () => {
    try {
      if (catEditId) {
        const base = import.meta.env.BASE_URL || '/';
        const token = localStorage.getItem('token');
        await fetch(`${base}api/categories/${catEditId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(catForm),
        });
      } else {
        await createCatMut.mutateAsync({ data: catForm as any });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      setCatModal(false);
    } catch(e) {}
  };

  const handleDeleteCat = async () => {
    if (!deleteConfirm) return;
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = localStorage.getItem('token');
      await fetch(`${base}api/categories/${deleteConfirm.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      setDeleteConfirm(null);
    } catch(e) {}
  };

  const handleSaveConfig = async () => {
    setConfigError(null);
    try {
      await updateConfigMut.mutateAsync({ data: configForm as any });
      queryClient.invalidateQueries({ queryKey: ['/api/config'] });
      setConfigModal(false);
    } catch(e: any) {
      setConfigError(e?.message || 'Failed to save configuration');
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-border flex justify-between items-center bg-muted/20">
            <h3 className="font-display font-semibold text-lg">Categories</h3>
            <Button size="sm" variant="outline" onClick={openAddCat}><Plus size={14}/> Add</Button>
          </div>
          <div className="p-0 flex-1 max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm text-left">
              <tbody className="divide-y divide-border">
                {categories?.map(c => (
                  <tr key={c.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-6 py-3 font-medium">{c.name}</td>
                    <td className="px-6 py-3"><Badge variant="neutral">{c.type}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEditCat(c)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Pencil size={14}/></button>
                        <button onClick={() => setDeleteConfirm({ id: c.id, name: c.name })} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 transition-colors" title="Delete"><Trash2 size={14}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border flex items-center gap-3 bg-muted/20">
            <Settings className="text-primary" size={20}/>
            <h3 className="font-display font-semibold text-lg">System Configuration</h3>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Cafe / Restaurant Name</span>
              <span className="font-medium">{(config as any)?.cafeName || 'Platr'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Currency</span>
              <span className="font-medium">{config?.currency || 'INR'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Costing Method</span>
              <span className="font-medium capitalize">{(config?.costingMethod || 'weighted_average').replace(/_/g, ' ')}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Decimal Precision</span>
              <span className="font-medium">{config?.decimalPrecision ?? 2}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">EOD Close Time</span>
              <span className="font-medium">{config?.businessDayCloseTime || '23:00'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Waste Threshold</span>
              <span className="font-medium">{Number(config?.wasteThresholdPercent ?? 5).toFixed(2)}%</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Low Stock Alert</span>
              <span className="font-medium">{config?.lowStockAlertDays ?? 3} days</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Daily Allocation</span>
              <span className="font-medium capitalize">{(config?.dailyAllocationMethod || 'equal_daily').replace(/_/g, ' ')}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Default Tax Rate</span>
              <span className="font-medium">{Number(config?.taxRate ?? 0).toFixed(2)}%</span>
            </div>
            <div className="mt-6 pt-4 text-center">
               <Button variant="outline" className="w-full" onClick={() => setConfigModal(true)}>Edit Configuration</Button>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={catModal} onClose={() => setCatModal(false)} title={catEditId ? "Edit Category" : "Add Category"}
        footer={<><Button variant="ghost" onClick={() => setCatModal(false)}>Cancel</Button><Button onClick={handleSaveCat}>{catEditId ? 'Update' : 'Save'}</Button></>}>
        <div className="space-y-5 py-2">
          <div><Label>Name</Label><Input value={catForm.name} onChange={(e:any) => setCatForm({...catForm, name: e.target.value})} /></div>
          <div>
            <Label>Type</Label>
            <select className="flex h-11 w-full rounded-xl border border-input bg-background px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={catForm.type} onChange={(e:any) => setCatForm({...catForm, type: e.target.value})}>
              <option value="ingredient">Ingredient</option>
              <option value="menu">Menu Item</option>
              <option value="expense">Expense</option>
            </select>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Category"
        footer={<><Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="danger" onClick={handleDeleteCat}>Delete</Button></>}>
        <p className="py-2 text-sm text-muted-foreground">
          Are you sure you want to delete <span className="font-semibold text-foreground">{deleteConfirm?.name}</span>? This action cannot be undone.
        </p>
      </Modal>

      <Modal isOpen={configModal} onClose={() => { setConfigModal(false); setConfigError(null); }} title="Edit System Configuration" maxWidth="max-w-lg"
        footer={<>
          <Button variant="ghost" onClick={() => { setConfigModal(false); setConfigError(null); }}>Cancel</Button>
          <Button onClick={handleSaveConfig} disabled={updateConfigMut.isPending}>
            {updateConfigMut.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </>}>
        <div className="space-y-5 py-2">
          {configError && (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-red-600 text-sm">{configError}</div>
          )}
          <div>
            <Label>Cafe / Restaurant Name</Label>
            <Input
              value={configForm.cafeName}
              onChange={(e:any) => setConfigForm({...configForm, cafeName: e.target.value})}
              placeholder="e.g. Joe's Cafe"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Shown in page headers and report headers across the app.</p>
          </div>
          <div>
            <Label>Costing Method</Label>
            <select className="flex h-11 w-full rounded-xl border border-input bg-background px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={configForm.costingMethod} onChange={(e:any) => setConfigForm({...configForm, costingMethod: e.target.value})}>
              <option value="weighted_average">Weighted Average</option>
              <option value="latest">Latest Cost</option>
              <option value="standard">Standard Cost</option>
            </select>
          </div>
          <div>
            <Label>Currency</Label>
            <Input value={configForm.currency} onChange={(e:any) => setConfigForm({...configForm, currency: e.target.value})} placeholder="INR" />
          </div>
          <div>
            <Label>Decimal Precision</Label>
            <Input type="number" min={0} max={6} value={configForm.decimalPrecision} onChange={(e:any) => setConfigForm({...configForm, decimalPrecision: Number(e.target.value)})} />
          </div>
          <div>
            <Label>Business Day Close Time</Label>
            <Input type="time" value={configForm.businessDayCloseTime} onChange={(e:any) => setConfigForm({...configForm, businessDayCloseTime: e.target.value})} />
          </div>
          <div>
            <Label>Waste Threshold (%)</Label>
            <Input type="number" step="0.5" min={0} value={configForm.wasteThresholdPercent} onChange={(e:any) => setConfigForm({...configForm, wasteThresholdPercent: Number(e.target.value)})} />
          </div>
          <div>
            <Label>Low Stock Alert (days)</Label>
            <Input type="number" min={1} max={30} value={configForm.lowStockAlertDays} onChange={(e:any) => setConfigForm({...configForm, lowStockAlertDays: Number(e.target.value)})} />
          </div>
          <div>
            <Label>Daily Allocation Method</Label>
            <select className="flex h-11 w-full rounded-xl border border-input bg-background px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={configForm.dailyAllocationMethod} onChange={(e:any) => setConfigForm({...configForm, dailyAllocationMethod: e.target.value})}>
              <option value="equal_daily">Equal Daily</option>
              <option value="weighted">Weighted</option>
            </select>
          </div>
          <div>
            <Label>Default Tax Rate (%)</Label>
            <Input type="number" step="0.5" min={0} value={configForm.taxRate} onChange={(e:any) => setConfigForm({...configForm, taxRate: Number(e.target.value)})} />
          </div>
        </div>
      </Modal>
    </>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useListUsers();
  const createMut = useCreateUser();
  const updateMut = useUpdateUser();
  const { roles: apiRoles } = useRoles();
  const { toast } = useToast();

  // Build role options from the API; fall back to the legacy hardcoded
  // list if roles haven't loaded yet (so the form is never empty).
  const roleOptions = apiRoles.length > 0
    ? apiRoles.map(r => ({ value: r.name, label: prettyRoleName(r.name), description: r.description || `${r.permissions.length} permission${r.permissions.length === 1 ? '' : 's'}` }))
    : ROLES;

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteUser, setDeleteUserState] = useState<any>(null);

  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    fullName: '',
    email: '',
    role: 'manager',
  });

  const [editForm, setEditForm] = useState({
    fullName: '',
    email: '',
    role: '',
    active: true,
    password: '',
  });

  const openCreate = () => {
    setCreateForm({ username: '', password: '', fullName: '', email: '', role: 'manager' });
    setIsCreateOpen(true);
  };

  const openEdit = (user: any) => {
    setEditUser(user);
    setEditForm({
      fullName: user.fullName || '',
      email: user.email || '',
      role: user.role,
      active: user.active,
      password: '',
    });
  };

  const handleCreate = async () => {
    if (!createForm.username || !createForm.password || !createForm.fullName) return;
    try {
      await createMut.mutateAsync({
        data: {
          username: createForm.username,
          password: createForm.password,
          fullName: createForm.fullName,
          email: createForm.email || undefined,
          role: createForm.role,
        },
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setIsCreateOpen(false);
    } catch (e: any) {
      alert(e?.data?.error || e?.message || 'Error creating user');
    }
  };

  const handleUpdate = async () => {
    if (!editUser) return;
    try {
      const updates: any = {
        fullName: editForm.fullName,
        email: editForm.email || undefined,
        role: editForm.role,
        active: editForm.active,
      };
      if (editForm.password) updates.password = editForm.password;
      await updateMut.mutateAsync({ id: editUser.id, data: updates });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setEditUser(null);
    } catch (e: any) {
      alert(e?.data?.error || e?.message || 'Error updating user');
    }
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    try {
      await customFetch(`/api/users/${deleteUser.id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({ title: 'User deleted', description: `${deleteUser.username} has been removed.` });
      setDeleteUserState(null);
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.data?.error || e?.message || 'Error deleting user', variant: 'destructive' });
    }
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={openCreate}><UserPlus size={18} /> Add User</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {roleOptions.map(r => {
          const count = users?.filter(u => u.role === r.value).length || 0;
          return (
            <div key={r.value} className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-foreground capitalize">{r.label}</span>
                <span className="text-2xl font-display font-bold text-primary">{count}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{r.description}</p>
            </div>
          );
        })}
      </div>

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Username</th>
              <th className="px-6 py-4">Full Name</th>
              <th className="px-6 py-4">Email</th>
              <th className="px-6 py-4">Role</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading users...</td></tr>
            ) : users?.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No users found.</td></tr>
            ) : users?.map(u => (
              <tr key={u.id} className="table-row-hover">
                <td className="px-6 py-4 font-medium text-foreground">{u.username}</td>
                <td className="px-6 py-4">{u.fullName}</td>
                <td className="px-6 py-4 text-muted-foreground">{u.email || '-'}</td>
                <td className="px-6 py-4"><RoleBadge role={u.role} /></td>
                <td className="px-6 py-4 text-center">
                  <Badge variant={u.active ? 'success' : 'danger'}>{u.active ? 'Active' : 'Inactive'}</Badge>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="inline-flex items-center gap-3">
                    <button onClick={() => openEdit(u)} className="text-muted-foreground hover:text-primary transition-colors" title="Edit">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => setDeleteUserState(u)} className="text-muted-foreground hover:text-rose-600 transition-colors" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Add New User" maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button><Button onClick={handleCreate} disabled={createMut.isPending || !createForm.username || !createForm.password || !createForm.fullName}>Create User</Button></>}>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <Label>Username</Label>
              <Input value={createForm.username} onChange={(e: any) => setCreateForm({ ...createForm, username: e.target.value })} placeholder="e.g. staff1" />
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" value={createForm.password} onChange={(e: any) => setCreateForm({ ...createForm, password: e.target.value })} placeholder="Min 6 characters" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <Label>Full Name</Label>
              <Input value={createForm.fullName} onChange={(e: any) => setCreateForm({ ...createForm, fullName: e.target.value })} placeholder="e.g. John Doe" />
            </div>
            <div>
              <Label>Email (Optional)</Label>
              <Input type="email" value={createForm.email} onChange={(e: any) => setCreateForm({ ...createForm, email: e.target.value })} placeholder="john@example.com" />
            </div>
          </div>
          <div>
            <Label>Role & Access Level</Label>
            <div className="space-y-2 mt-2 max-h-72 overflow-y-auto pr-1">
              {roleOptions.map(r => (
                <label key={r.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${createForm.role === r.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <input type="radio" name="role" value={r.value} checked={createForm.role === r.value} onChange={() => setCreateForm({ ...createForm, role: r.value })} className="mt-1" />
                  <div>
                    <p className="font-medium text-sm capitalize">{r.label}</p>
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!editUser} onClose={() => setEditUser(null)} title={`Edit User — ${editUser?.username}`} maxWidth="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setEditUser(null)}>Cancel</Button><Button onClick={handleUpdate} disabled={updateMut.isPending}>Save Changes</Button></>}>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <Label>Full Name</Label>
              <Input value={editForm.fullName} onChange={(e: any) => setEditForm({ ...editForm, fullName: e.target.value })} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={editForm.email} onChange={(e: any) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Role & Access Level</Label>
            <div className="space-y-2 mt-2 max-h-72 overflow-y-auto pr-1">
              {roleOptions.map(r => (
                <label key={r.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${editForm.role === r.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <input type="radio" name="editRole" value={r.value} checked={editForm.role === r.value} onChange={() => setEditForm({ ...editForm, role: r.value })} className="mt-1" />
                  <div>
                    <p className="font-medium text-sm capitalize">{r.label}</p>
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <Label>New Password (leave blank to keep)</Label>
              <Input type="password" value={editForm.password} onChange={(e: any) => setEditForm({ ...editForm, password: e.target.value })} placeholder="••••••" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={editForm.active ? 'true' : 'false'} onChange={(e: any) => setEditForm({ ...editForm, active: e.target.value === 'true' })}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteUser} onClose={() => setDeleteUserState(null)} title="Delete User" maxWidth="max-w-md"
        footer={<><Button variant="ghost" onClick={() => setDeleteUserState(null)}>Cancel</Button><Button onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">Delete User</Button></>}>
        <div className="py-2 space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-rose-50 border border-rose-200">
            <AlertTriangle className="text-rose-600 mt-0.5 flex-shrink-0" size={20} />
            <div className="text-sm text-rose-800">
              This will permanently remove <strong>{deleteUser?.username}</strong> ({deleteUser?.fullName}) and revoke all access. This cannot be undone.
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Tip: if you only want to disable access temporarily, edit the user and set status to Inactive instead.</p>
        </div>
      </Modal>
    </>
  );
}

function RolesTab() {
  const { roles, loading, reload } = useRoles();
  const catalog = usePermissionsCatalog();
  const { toast } = useToast();

  const [editing, setEditing] = useState<ApiRole | null>(null);
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', permissions: new Set<string>() });
  const [deleteRole, setDeleteRole] = useState<ApiRole | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const openEdit = (r: ApiRole) => {
    setEditing(r);
    setEditPerms(new Set(r.permissions));
    setEditDescription(r.description || '');
  };

  const togglePerm = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const toggleCategory = (set: Set<string>, cat: PermissionCategory, setter: (s: Set<string>) => void, allOn: boolean) => {
    const next = new Set(set);
    for (const p of cat.permissions) {
      if (allOn) next.delete(p.key); else next.add(p.key);
    }
    setter(next);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await customFetch(`/api/roles/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: editDescription, permissions: [...editPerms] }),
      });
      toast({ title: 'Role updated', description: `${prettyRoleName(editing.name)} permissions saved.` });
      setEditing(null);
      reload();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.data?.error || e?.message || 'Error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const saveCreate = async () => {
    if (!createForm.name.trim()) return;
    setSaving(true);
    try {
      await customFetch('/api/roles', {
        method: 'POST',
        body: JSON.stringify({
          name: createForm.name.trim(),
          description: createForm.description.trim() || null,
          permissions: [...createForm.permissions],
        }),
      });
      toast({ title: 'Role created', description: `${createForm.name} is ready to assign.` });
      setCreateOpen(false);
      setCreateForm({ name: '', description: '', permissions: new Set() });
      reload();
    } catch (e: any) {
      toast({ title: 'Create failed', description: e?.data?.error || e?.message || 'Error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRole) return;
    try {
      await customFetch(`/api/roles/${deleteRole.id}`, { method: 'DELETE' });
      toast({ title: 'Role deleted', description: `${prettyRoleName(deleteRole.name)} removed.` });
      setDeleteRole(null);
      reload();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.data?.error || e?.message || 'Cannot delete', variant: 'destructive' });
    }
  };

  const renderMatrix = (current: Set<string>, setter: (s: Set<string>) => void, readOnly: boolean) => {
    if (!catalog) return <p className="text-sm text-muted-foreground py-6 text-center">Loading permission catalog…</p>;
    return (
      <div className="space-y-3">
        {catalog.categories.map(cat => {
          const isCollapsed = collapsed.has(cat.id);
          const enabledInCat = cat.permissions.filter(p => current.has(p.key)).length;
          const allOn = enabledInCat === cat.permissions.length;
          return (
            <div key={cat.id} className="border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
                <button
                  type="button"
                  onClick={() => {
                    const n = new Set(collapsed);
                    if (isCollapsed) n.delete(cat.id); else n.add(cat.id);
                    setCollapsed(n);
                  }}
                  className="flex items-center gap-2 font-semibold text-sm text-foreground"
                >
                  <span className={`inline-block transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▸</span>
                  {cat.label}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{enabledInCat}/{cat.permissions.length}</span>
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => toggleCategory(current, cat, setter, allOn)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {allOn ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>
              {!isCollapsed && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1 p-3">
                  {cat.permissions.map(p => {
                    const checked = current.has(p.key);
                    return (
                      <label key={p.key} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${checked ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/40'} ${readOnly ? 'cursor-not-allowed opacity-90' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={readOnly}
                          onChange={() => togglePerm(current, p.key, setter)}
                          className="mt-1 accent-primary"
                        />
                        <span className="flex-1">
                          <span className="block">{p.label}</span>
                          <span className="block text-xs text-muted-foreground font-mono">{p.key}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">
          Roles bundle permissions by feature category (Operations, Accounts, Purchase, HR, Reports, Admin). Built-in roles can be tuned but not deleted.
        </p>
        <Button onClick={() => setCreateOpen(true)}><Plus size={18} /> New Role</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading && <div className="col-span-full text-center text-muted-foreground py-8">Loading roles…</div>}
        {!loading && roles.map(r => (
          <div key={r.id} className="bg-card rounded-xl border border-border p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <RoleBadge role={r.name} />
                  {r.isBuiltIn && <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Built-in</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2 min-h-[2.5rem]">{r.description || '—'}</p>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-3">
              <span>{r.permissions.length} permission{r.permissions.length === 1 ? '' : 's'}</span>
              <span>{r.userCount} user{r.userCount === 1 ? '' : 's'}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => openEdit(r)} className="flex-1"><Pencil size={14} /> Edit</Button>
              {!r.isBuiltIn && (
                <Button variant="ghost" onClick={() => setDeleteRole(r)} className="text-rose-600 hover:bg-rose-50">
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Edit Role — ${prettyRoleName(editing.name)}` : ''}
        maxWidth="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
          </>
        }
      >
        <div className="space-y-4 py-2">
          <div>
            <Label>Description</Label>
            <Input value={editDescription} onChange={(e: any) => setEditDescription(e.target.value)} placeholder="What does this role do?" />
          </div>
          <div className="flex items-center justify-between">
            <Label>Permissions ({editPerms.size} selected)</Label>
            {catalog && (
              <button
                type="button"
                onClick={() => setEditPerms(editPerms.size === catalog.allKeys.length ? new Set() : new Set(catalog.allKeys))}
                className="text-xs font-medium text-primary hover:underline"
              >
                {catalog && editPerms.size === catalog.allKeys.length ? 'Clear all' : 'Grant everything'}
              </button>
            )}
          </div>
          {renderMatrix(editPerms, setEditPerms, false)}
        </div>
      </Modal>

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Custom Role"
        maxWidth="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={saveCreate} disabled={saving || !createForm.name.trim()}>{saving ? 'Saving…' : 'Create Role'}</Button>
          </>
        }
      >
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Role Name</Label>
              <Input value={createForm.name} onChange={(e: any) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g. shift_lead" />
              <p className="text-xs text-muted-foreground mt-1">Lowercase, underscores allowed. Will be normalized.</p>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={createForm.description} onChange={(e: any) => setCreateForm({ ...createForm, description: e.target.value })} placeholder="Brief description" />
            </div>
          </div>
          <div>
            <Label>Permissions ({createForm.permissions.size} selected)</Label>
            <div className="mt-2">
              {renderMatrix(createForm.permissions, (s) => setCreateForm({ ...createForm, permissions: s }), false)}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!deleteRole}
        onClose={() => setDeleteRole(null)}
        title="Delete Role"
        maxWidth="max-w-md"
        footer={<><Button variant="ghost" onClick={() => setDeleteRole(null)}>Cancel</Button><Button onClick={confirmDelete} className="bg-rose-600 hover:bg-rose-700">Delete</Button></>}
      >
        <div className="py-2 space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-rose-50 border border-rose-200">
            <AlertTriangle className="text-rose-600 mt-0.5 flex-shrink-0" size={20} />
            <div className="text-sm text-rose-800">
              Permanently delete the <strong>{deleteRole?.name}</strong> role? This cannot be undone.
              {deleteRole && deleteRole.userCount > 0 && (
                <p className="mt-2 font-semibold">⚠ {deleteRole.userCount} user(s) currently have this role and must be reassigned first.</p>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

function AuditLogsTab() {
  const [moduleFilter, setModuleFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [logs, setLogs] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadLogs = React.useCallback(async () => {
    setLoading(true);
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (moduleFilter) params.set('module', moduleFilter);
      if (actionFilter) params.set('action', actionFilter);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      const res = await fetch(`${base}api/audit-logs?${params.toString()}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setLogs(await res.json());
    } catch { }
    setLoading(false);
  }, [moduleFilter, actionFilter, fromDate, toDate]);

  React.useEffect(() => { loadLogs(); }, [loadLogs]);

  const MODULES = ['vendors', 'ingredients', 'menu-items', 'purchases', 'expenses', 'sales', 'waste', 'settlements', 'petty-cash', 'attendance', 'users', 'categories'];
  const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'VERIFY', 'UNVERIFY'];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <Label className="text-xs">Module</Label>
          <Select value={moduleFilter} onChange={(e: any) => setModuleFilter(e.target.value)}>
            <option value="">All Modules</option>
            {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Action</Label>
          <Select value={actionFilter} onChange={(e: any) => setActionFilter(e.target.value)}>
            <option value="">All Actions</option>
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </Select>
        </div>
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" max={new Date().toISOString().split('T')[0]} value={fromDate} onChange={(e: any) => setFromDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" max={new Date().toISOString().split('T')[0]} value={toDate} onChange={(e: any) => setToDate(e.target.value)} className="w-40" />
        </div>
        {(moduleFilter || actionFilter || fromDate || toDate) && (
          <Button variant="ghost" onClick={() => { setModuleFilter(''); setActionFilter(''); setFromDate(''); setToDate(''); }} className="text-xs">Clear Filters</Button>
        )}
      </div>

      {logs && <p className="text-xs text-muted-foreground">{logs.total} log(s) found</p>}

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Timestamp</th>
              <th className="px-6 py-4">Module</th>
              <th className="px-6 py-4">Action</th>
              <th className="px-6 py-4">Record ID</th>
              <th className="px-6 py-4">Changed By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading logs...</td></tr>
            ) : logs?.items?.length === 0 || !logs ? (
               <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No audit logs match your filters.</td></tr>
            ) : logs.items.map((log: any) => (
              <tr key={log.id} className="table-row-hover">
                <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{new Date(log.changedAt).toLocaleString()}</td>
                <td className="px-6 py-4 font-medium capitalize">{log.module}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${log.action === 'DELETE' ? 'bg-red-100 text-red-700' : log.action === 'CREATE' ? 'bg-emerald-100 text-emerald-700' : 'bg-secondary text-secondary-foreground'}`}>
                    {log.action}
                  </span>
                </td>
                <td className="px-6 py-4 text-muted-foreground">#{log.recordId}</td>
                <td className="px-6 py-4 text-foreground">{log.changedBy || 'System'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const BASE = import.meta.env.BASE_URL || '/';
const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim();

function getPosApiBase() {
  if (API_BASE && !window.location.hostname.includes('replit')) {
    return API_BASE.replace(/\/+$/, '');
  }
  return BASE.replace(/\/+$/, '');
}

async function posApiFetch(path: string, opts?: any) {
  const token = localStorage.getItem('token');
  const headers: any = { 'Authorization': `Bearer ${token}` };
  if (opts?.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${getPosApiBase()}/api/${path}`, { ...opts, headers: { ...headers, ...opts?.headers } });
  if (!res.ok) { const t = await res.text(); throw new Error(t); }
  return res.json();
}

const PROVIDERS = [
  { value: 'petpooja', label: 'Petpooja', description: 'POS system with order sync, item mapping, and Excel/API import' },
  { value: 'posist', label: 'POSist', description: 'Cloud-based POS with menu sync and order push' },
  { value: 'urbanpiper', label: 'UrbanPiper', description: 'Aggregator middleware for Swiggy/Zomato/direct orders' },
  { value: 'custom', label: 'Custom / Generic', description: 'Generic webhook-based integration for any POS system' },
];

function POSIntegrationsTab() {
  const { toast } = useToast();
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [detailView, setDetailView] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [capabilities, setCapabilities] = useState<any>(null);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const todayIso = () => new Date().toISOString().split('T')[0];
  const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; };
  const [fetchFrom, setFetchFrom] = useState<string>(daysAgoIso(7));
  const [fetchTo, setFetchTo] = useState<string>(todayIso());
  const [selectedTypes, setSelectedTypes] = useState<Record<string, boolean>>({ sales: true, customers: true });
  const [fetching, setFetching] = useState(false);
  const [fetchResults, setFetchResults] = useState<Record<string, any> | null>(null);

  const [form, setForm] = useState({
    name: '', provider: 'petpooja', apiKey: '', apiSecret: '', restaurantId: '', baseUrl: '',
    accessToken: '', autoSync: false, syncMenuItems: true, syncOrders: true,
    defaultGstPercent: 5, defaultOrderType: 'dine-in', active: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await posApiFetch('pos-integrations'); setIntegrations(data); } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditId(null);
    setForm({ name: '', provider: 'petpooja', apiKey: '', apiSecret: '', restaurantId: '', baseUrl: '',
      accessToken: '', autoSync: false, syncMenuItems: true, syncOrders: true,
      defaultGstPercent: 5, defaultOrderType: 'dine-in', active: true });
    setShowModal(true);
  };

  const openEdit = (i: any) => {
    setEditId(i.id);
    setForm({
      name: i.name, provider: i.provider, apiKey: '', apiSecret: '', restaurantId: i.restaurantId || '',
      baseUrl: i.baseUrl || '', accessToken: '', autoSync: i.autoSync, syncMenuItems: i.syncMenuItems,
      syncOrders: i.syncOrders, defaultGstPercent: i.defaultGstPercent, defaultOrderType: i.defaultOrderType, active: i.active,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    try {
      const body: any = { ...form };
      if (!body.apiKey) delete body.apiKey;
      if (!body.apiSecret) delete body.apiSecret;
      if (!body.accessToken) delete body.accessToken;
      if (!body.baseUrl) delete body.baseUrl;
      if (editId) {
        await posApiFetch(`pos-integrations/${editId}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast({ title: 'Integration updated' });
      } else {
        await posApiFetch('pos-integrations', { method: 'POST', body: JSON.stringify(body) });
        toast({ title: 'Integration created' });
      }
      setShowModal(false);
      load();
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await posApiFetch(`pos-integrations/${deleteConfirm.id}`, { method: 'DELETE' });
      toast({ title: 'Deleted' });
      setDeleteConfirm(null);
      if (detailView?.id === deleteConfirm.id) setDetailView(null);
      load();
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const loadSyncLogs = async (id: number) => {
    try { const d = await posApiFetch(`pos-integrations/${id}/sync-logs?limit=20`); setSyncLogs(d.logs || []); } catch { setSyncLogs([]); }
  };

  const viewDetail = async (i: any) => {
    setDetailView(i);
    setWebhookSecret(null);
    setCapabilities(null);
    setFetchResults(null);
    setSelectedTypes({ sales: true, customers: true });
    setFetchFrom(daysAgoIso(7));
    setFetchTo(todayIso());
    try { const s = await posApiFetch(`pos-integrations/${i.id}/stats`); setStats(s); } catch { setStats(null); }
    try { const c = await posApiFetch(`pos-integrations/${i.id}/capabilities`); setCapabilities(c); } catch { setCapabilities(null); }
    loadSyncLogs(i.id);
  };

  const handleFetchFromPos = async () => {
    if (!detailView) return;
    const dataTypes = Object.entries(selectedTypes).filter(([, v]) => v).map(([k]) => k);
    if (dataTypes.length === 0) { toast({ title: 'Select at least one data type', variant: 'destructive' }); return; }
    if (!fetchFrom || !fetchTo) { toast({ title: 'Pick a from and to date', variant: 'destructive' }); return; }
    if (fetchFrom > fetchTo) { toast({ title: 'From date must be on or before To date', variant: 'destructive' }); return; }
    setFetching(true);
    setFetchResults(null);
    try {
      const data = await posApiFetch(`pos-integrations/${detailView.id}/fetch`, {
        method: 'POST', body: JSON.stringify({ dataTypes, from: fetchFrom, to: fetchTo }),
      });
      setFetchResults(data.results || {});
      const totalOk = Object.values(data.results || {}).filter((r: any) => r.status === 'success' || r.status === 'partial').length;
      toast({ title: `Fetch complete`, description: `${totalOk} of ${dataTypes.length} types succeeded` });
      loadSyncLogs(detailView.id);
      try { const s = await posApiFetch(`pos-integrations/${detailView.id}/stats`); setStats(s); } catch {}
    } catch (e: any) {
      toast({ title: 'Fetch failed', description: e.message, variant: 'destructive' });
    } finally { setFetching(false); }
  };

  const showSecret = async (id: number) => {
    try { const data = await posApiFetch(`pos-integrations/${id}/webhook-secret`); setWebhookSecret(data.webhookSecret); } catch {}
  };

  const regenerateSecret = async (id: number) => {
    try {
      const data = await posApiFetch(`pos-integrations/${id}/regenerate-webhook-secret`, { method: 'POST' });
      setWebhookSecret(data.webhookSecret);
      toast({ title: 'Webhook secret regenerated' });
      load();
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const testConnection = async (id: number) => {
    try {
      const data = await posApiFetch(`pos-integrations/${id}/test-connection`, { method: 'POST' });
      toast({ title: data.success ? 'Connection OK' : 'Connection Issue', description: data.message, variant: data.success ? 'default' : 'destructive' });
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const webhookUrl = (id: number) => {
    const base = window.location.origin;
    return `${base}${BASE}api/webhook/petpooja/${id}`;
  };

  if (detailView) {
    const provInfo = PROVIDERS.find(p => p.value === detailView.provider);
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => { setDetailView(null); setStats(null); }} className="text-sm text-primary hover:underline">&larr; Back to Integrations</button>
          <h3 className="text-lg font-semibold">{detailView.name}</h3>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${detailView.active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {detailView.active ? <Wifi size={11} /> : <WifiOff size={11} />} {detailView.active ? 'Active' : 'Inactive'}
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-card rounded-xl border p-5 space-y-4">
            <h4 className="font-semibold flex items-center gap-2"><Settings size={16} /> Configuration</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span className="font-medium capitalize">{provInfo?.label || detailView.provider}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Restaurant ID</span><span className="font-medium">{detailView.restaurantId || '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">API Key</span><span className="font-medium">{detailView.apiKey || '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auto Sync</span><span className="font-medium">{detailView.autoSync ? 'Yes' : 'No'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Default GST %</span><span className="font-medium">{detailView.defaultGstPercent}%</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Default Order Type</span><span className="font-medium capitalize">{detailView.defaultOrderType}</span></div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => openEdit(detailView)} className="gap-1"><Pencil size={14} /> Edit</Button>
              <Button variant="outline" onClick={() => testConnection(detailView.id)} className="gap-1"><RefreshCw size={14} /> Test</Button>
              <Button variant="danger" onClick={() => setDeleteConfirm(detailView)} className="gap-1"><Trash size={14} /> Delete</Button>
            </div>
          </div>

          <div className="bg-card rounded-xl border p-5 space-y-4">
            <h4 className="font-semibold flex items-center gap-2"><Wifi size={16} /> Webhook Endpoint</h4>
            <p className="text-xs text-muted-foreground">Use this URL in your POS system to push orders automatically.</p>
            <div className="bg-muted rounded-lg p-3 text-xs font-mono break-all">{webhookUrl(detailView.id)}</div>
            <button onClick={() => copyToClipboard(webhookUrl(detailView.id))} className="text-xs text-primary hover:underline flex items-center gap-1"><Copy size={12} /> Copy URL</button>

            <div className="border-t pt-3">
              <h5 className="text-sm font-medium mb-2">Webhook Secret</h5>
              {webhookSecret ? (
                <div className="space-y-2">
                  <div className="bg-muted rounded-lg p-3 text-xs font-mono break-all">{webhookSecret}</div>
                  <div className="flex gap-2">
                    <button onClick={() => copyToClipboard(webhookSecret)} className="text-xs text-primary hover:underline flex items-center gap-1"><Copy size={12} /> Copy</button>
                    <button onClick={() => setWebhookSecret(null)} className="text-xs text-muted-foreground hover:underline">Hide</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => showSecret(detailView.id)} className="text-xs">Show Secret</Button>
                  <Button variant="outline" onClick={() => regenerateSecret(detailView.id)} className="text-xs gap-1"><RefreshCw size={12} /> Regenerate</Button>
                </div>
              )}
            </div>

            <div className="border-t pt-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Request Format:</p>
              <p>POST with header <code className="bg-muted px-1 rounded">X-Webhook-Secret: &lt;secret&gt;</code></p>
              <p className="mt-1">Body: <code className="bg-muted px-1 rounded">{'{ "orders": [{ "order_id", "order_date", "items": [...] }] }'}</code></p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border p-5 space-y-4" data-testid="pos-fetch-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold flex items-center gap-2"><RefreshCw size={16} /> Pull from POS</h4>
              <p className="text-xs text-muted-foreground mt-1">Manually fetch data from {PROVIDERS.find(p => p.value === detailView.provider)?.label || detailView.provider} on demand. Already-imported records are skipped automatically.</p>
            </div>
          </div>

          {!capabilities ? (
            <div className="text-xs text-muted-foreground">Loading capabilities...</div>
          ) : (
            <>
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground/70">Data to fetch</Label>
                <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                  {capabilities.dataTypes.map((dt: any) => {
                    const supported = dt.status === 'supported';
                    const tip = dt.status === 'not_supported' ? `Not exposed by ${capabilities.provider}` : dt.status === 'webhook_only' ? `${capabilities.provider} pushes this via webhook only` : '';
                    return (
                      <label key={dt.key} title={tip}
                        className={`flex items-start gap-2 text-sm p-2 rounded-lg border ${supported ? 'cursor-pointer hover:bg-muted/40' : 'opacity-50 cursor-not-allowed bg-muted/30'}`}
                        data-testid={`pos-fetch-type-${dt.key}`}>
                        <input type="checkbox" disabled={!supported}
                          checked={!!selectedTypes[dt.key] && supported}
                          onChange={e => setSelectedTypes(s => ({ ...s, [dt.key]: e.target.checked }))}
                          className="mt-0.5 rounded" data-testid={`pos-fetch-checkbox-${dt.key}`} />
                        <div className="flex-1">
                          <div className="font-medium leading-tight">{dt.label}</div>
                          {!supported && (
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {dt.status === 'webhook_only' ? 'Webhook only' : 'Not supported'}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={fetchFrom} max={fetchTo || todayIso()} onChange={e => setFetchFrom(e.target.value)} data-testid="pos-fetch-from" />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={fetchTo} min={fetchFrom} max={todayIso()} onChange={e => setFetchTo(e.target.value)} data-testid="pos-fetch-to" />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleFetchFromPos} disabled={fetching} className="gap-1" data-testid="pos-fetch-button">
                    <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
                    {fetching ? 'Fetching...' : 'Fetch Now'}
                  </Button>
                </div>
              </div>

              {fetchResults && (
                <div className="border rounded-lg divide-y" data-testid="pos-fetch-results">
                  {Object.entries(fetchResults).map(([k, r]: any) => {
                    const color = r.status === 'success' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                      : r.status === 'partial' ? 'text-amber-700 bg-amber-50 border-amber-200'
                      : r.status === 'skipped' ? 'text-slate-600 bg-slate-50 border-slate-200'
                      : 'text-red-700 bg-red-50 border-red-200';
                    const label = capabilities.dataTypes.find((d: any) => d.key === k)?.label || k;
                    return (
                      <div key={k} className="p-3 text-sm flex items-start gap-3" data-testid={`pos-fetch-result-${k}`}>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${color}`}>{r.status}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{label}</div>
                          <div className="text-xs text-muted-foreground break-words">{r.message}</div>
                        </div>
                        {(r.count > 0 || r.errorCount > 0) && (
                          <div className="text-xs text-right shrink-0">
                            {r.count > 0 && <div className="text-emerald-600 font-medium font-numbers">+{r.count}</div>}
                            {r.errorCount > 0 && <div className="text-red-600 font-numbers">{r.errorCount} err</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="bg-card rounded-xl border" data-testid="pos-sync-logs">
          <div className="p-4 border-b flex items-center justify-between">
            <h4 className="font-semibold text-sm">Recent Fetches</h4>
            <button onClick={() => loadSyncLogs(detailView.id)} className="text-xs text-primary hover:underline flex items-center gap-1"><RefreshCw size={11} /> Refresh</button>
          </div>
          {syncLogs.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No fetches yet. Use the panel above to pull data on demand.</div>
          ) : (
            <div className="divide-y max-h-80 overflow-y-auto">
              {syncLogs.map(l => {
                const color = l.status === 'success' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : l.status === 'partial' ? 'text-amber-700 bg-amber-50 border-amber-200'
                  : l.status === 'skipped' ? 'text-slate-600 bg-slate-50 border-slate-200'
                  : 'text-red-700 bg-red-50 border-red-200';
                return (
                  <div key={l.id} className="px-4 py-3 text-sm flex items-start gap-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${color}`}>{l.status}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium capitalize">{(l.dataType || '').replace('_', ' ')}</span>
                        {(l.fromDate || l.toDate) && <span className="text-[11px] text-muted-foreground">{l.fromDate} → {l.toDate}</span>}
                        <span className="text-[11px] text-muted-foreground">· {new Date(l.createdAt).toLocaleString()}</span>
                      </div>
                      {l.message && <div className="text-xs text-muted-foreground mt-0.5 break-words">{l.message}</div>}
                    </div>
                    <div className="text-xs text-right shrink-0 font-numbers">
                      {l.recordCount > 0 && <div className="text-emerald-600">+{l.recordCount}</div>}
                      {l.errorCount > 0 && <div className="text-red-600">{l.errorCount} err</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {stats && detailView.provider === 'petpooja' && (
          <div className="space-y-5">
            <h4 className="font-semibold">Sync Statistics</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-card rounded-xl border p-4">
                <p className="text-xs text-muted-foreground uppercase">Total Orders Synced</p>
                <p className="text-xl font-bold font-numbers">{stats.totalOrdersSynced}</p>
              </div>
              <div className="bg-card rounded-xl border p-4">
                <p className="text-xs text-muted-foreground uppercase">Invoices Imported</p>
                <p className="text-xl font-bold font-numbers">{stats.totalInvoicesImported}</p>
              </div>
              <div className="bg-card rounded-xl border p-4">
                <p className="text-xs text-muted-foreground uppercase">Auto-Created Items</p>
                <p className="text-xl font-bold font-numbers text-blue-600">{stats.autoCreatedMenuItems || 0}</p>
              </div>
            </div>

            {detailView.lastSyncAt && (
              <div className="bg-card rounded-xl border p-4 text-sm">
                <p className="text-muted-foreground">Last Sync: <span className="text-foreground font-medium">{new Date(detailView.lastSyncAt).toLocaleString()}</span></p>
                <p className="text-muted-foreground">Status: <span className={`font-medium ${detailView.lastSyncStatus === 'success' ? 'text-emerald-600' : 'text-orange-600'}`}>{detailView.lastSyncStatus || 'Never synced'}</span></p>
                {detailView.lastSyncMessage && <p className="text-muted-foreground">Message: <span className="text-foreground">{detailView.lastSyncMessage}</span></p>}
              </div>
            )}

            {stats.recentBatches?.length > 0 && (
              <div className="bg-card rounded-2xl border border-border shadow-sm overflow-x-auto">
                <div className="p-4 border-b"><h5 className="font-semibold text-sm">Recent Import Batches</h5></div>
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-transparent">
                    <th className="px-4 py-2 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Date</th>
                    <th className="px-4 py-2 text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">File</th>
                    <th className="px-4 py-2 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Invoices</th>
                    <th className="px-4 py-2 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Success</th>
                    <th className="px-4 py-2 text-right text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Failed</th>
                  </tr></thead>
                  <tbody>
                    {stats.recentBatches.map((b: any) => (
                      <tr key={b.id} className="border-b">
                        <td className="px-4 py-2">{new Date(b.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-2">{b.fileName || '-'}</td>
                        <td className="px-4 py-2 text-right font-numbers">{b.invoiceCount}</td>
                        <td className="px-4 py-2 text-right font-numbers text-emerald-600">{b.successCount}</td>
                        <td className="px-4 py-2 text-right font-numbers text-red-600">{b.failedCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Integration"
          footer={<><Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}>
          <p className="py-2 text-sm text-muted-foreground">Delete <span className="font-semibold text-foreground">{deleteConfirm?.name}</span>? This removes the configuration only — imported invoices are preserved.</p>
        </Modal>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">POS & Third-Party Integrations</h3>
          <p className="text-sm text-muted-foreground">Connect your POS systems to automatically sync orders, menu items, and sales data.</p>
        </div>
        <Button onClick={openCreate} className="gap-1"><Plus size={16} /> Add Integration</Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : integrations.length === 0 ? (
        <div className="bg-card rounded-xl border p-8 text-center space-y-3">
          <Plug size={40} className="mx-auto text-muted-foreground" />
          <h4 className="font-semibold">No Integrations Configured</h4>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">Add a POS integration to start syncing orders automatically. Supported: Petpooja, POSist, UrbanPiper, or any custom POS via webhook.</p>
          <Button onClick={openCreate} className="gap-1"><Plus size={16} /> Add Your First Integration</Button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {integrations.map(i => {
            const provInfo = PROVIDERS.find(p => p.value === i.provider);
            return (
              <div key={i.id} className="bg-card rounded-xl border p-5 hover:border-primary/50 transition-colors cursor-pointer" onClick={() => viewDetail(i)}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${i.active ? 'bg-emerald-500' : 'bg-red-400'}`} />
                    <h4 className="font-semibold">{i.name}</h4>
                  </div>
                  <span className="text-xs text-muted-foreground capitalize bg-muted px-2 py-0.5 rounded-full">{provInfo?.label || i.provider}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{provInfo?.description}</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {i.restaurantId && <span>ID: {i.restaurantId}</span>}
                  <span>{i.totalOrdersSynced} orders synced</span>
                  {i.lastSyncAt && <span>Last: {new Date(i.lastSyncAt).toLocaleDateString()}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-muted/50 rounded-xl border p-5 space-y-3">
        <h4 className="font-semibold text-sm flex items-center gap-2"><AlertTriangle size={14} className="text-orange-500" /> Integration Guide</h4>
        <div className="grid md:grid-cols-3 gap-4 text-xs text-muted-foreground">
          <div>
            <p className="font-medium text-foreground mb-1">1. Add Integration</p>
            <p>Configure your POS provider, enter API credentials, and set defaults (GST%, order type).</p>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">2. Set Up Webhook</p>
            <p>Copy the webhook URL and secret into your POS system settings. Orders push automatically.</p>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">3. Auto-Created Items</p>
            <p>When orders arrive, categories and menu items are auto-created from POS data if they don't already exist.</p>
          </div>
        </div>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editId ? "Edit Integration" : "Add POS Integration"} maxWidth="max-w-2xl"
        footer={<><Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave}>{editId ? 'Update' : 'Create'}</Button></>}>
        <div className="space-y-5 py-2 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Integration Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Petpooja Main Branch" /></div>
            <div><Label>Provider *</Label><Select value={form.provider} onChange={(e: any) => setForm({ ...form, provider: e.target.value })}>
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select></div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>Restaurant ID</Label><Input value={form.restaurantId} onChange={e => setForm({ ...form, restaurantId: e.target.value })} placeholder="Your POS restaurant ID" /></div>
            <div><Label>Base URL</Label><Input value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.petpooja.com" /></div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div><Label>API Key</Label><Input value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder={editId ? 'Leave blank to keep current' : 'API Key'} /></div>
            <div><Label>Access Token</Label><Input type="password" value={form.accessToken} onChange={e => setForm({ ...form, accessToken: e.target.value })} placeholder={editId ? 'Leave blank to keep current' : 'Token'} /></div>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-5">
            <div><Label>Default GST %</Label><Input type="number" min="0" max="28" value={form.defaultGstPercent} onChange={e => setForm({ ...form, defaultGstPercent: Number(e.target.value) })} /></div>
            <div><Label>Default Order Type</Label><Select value={form.defaultOrderType} onChange={(e: any) => setForm({ ...form, defaultOrderType: e.target.value })}>
              <option value="dine-in">Dine In</option>
              <option value="takeaway">Takeaway</option>
              <option value="delivery">Delivery</option>
              <option value="online">Online</option>
            </Select></div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer h-10">
                <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} className="rounded" />
                Active
              </label>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-5">
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.syncOrders} onChange={e => setForm({ ...form, syncOrders: e.target.checked })} className="rounded" /> Sync Orders</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.syncMenuItems} onChange={e => setForm({ ...form, syncMenuItems: e.target.checked })} className="rounded" /> Sync Menu Items</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.autoSync} onChange={e => setForm({ ...form, autoSync: e.target.checked })} className="rounded" /> Auto Sync</label>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function Masters() {
  const [activeTab, setActiveTab] = useState<TabId>('config');

  return (
    <div className="space-y-6">
      <PageHeader title="Masters & Configuration" description="Manage categories, system settings, users, and audit logs">
        <Button onClick={async () => {
          try {
            const base = import.meta.env.BASE_URL || '/';
            const token = localStorage.getItem('token');
            const response = await fetch(`${base}api/backup/download`, {
              headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!response.ok) throw new Error('Backup failed');
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = response.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || 'backup.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch { alert('Backup download failed'); }
        }} variant="outline" className="gap-2">
          <Download size={16} /> Download Backup
        </Button>
      </PageHeader>

      <div className="border-b border-border">
        <nav className="flex gap-1 -mb-px">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === 'config' && <CategoriesConfigTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'roles' && <RolesTab />}
      {activeTab === 'notifications' && <NotificationsTab />}
      {activeTab === 'pos' && <POSIntegrationsTab />}
      {activeTab === 'audit' && <AuditLogsTab />}
    </div>
  );
}

// ============================================================
// Notifications & Mail Setup
// ============================================================
type MailConfig = {
  id: number | null;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  hasPassword: boolean;
  fromEmail: string;
  fromName: string;
  secure: boolean;
  enabled: boolean;
};
type AlertTypeDef = { type: string; label: string; description: string; defaultThreshold?: Record<string, number | string> };
type ScheduleDef = { id: string; label: string };
type NotificationRule = {
  id: number;
  name: string;
  type: string;
  schedule: string;
  recipients: string[];
  threshold: Record<string, number | string> | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
type NotificationLog = {
  id: number;
  ruleId: number | null;
  ruleName: string;
  type: string;
  status: string;
  subject: string | null;
  recipientsCount: number;
  recipients: string[] | null;
  error: string | null;
  trigger: string;
  sentAt: string;
};

function NotificationsTab() {
  const { toast } = useToast();
  const [section, setSection] = useState<'mail' | 'rules' | 'logs'>('mail');
  const [mail, setMail] = useState<MailConfig | null>(null);
  const [mailSaving, setMailSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [types, setTypes] = useState<AlertTypeDef[]>([]);
  const [schedules, setSchedules] = useState<ScheduleDef[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [editing, setEditing] = useState<NotificationRule | null>(null);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [deleteRule, setDeleteRule] = useState<NotificationRule | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [m, t, r, l] = await Promise.all([
        customFetch<MailConfig>('/api/mail-config'),
        customFetch<{ types: AlertTypeDef[]; schedules: ScheduleDef[] }>('/api/notification-types'),
        customFetch<NotificationRule[]>('/api/notification-rules'),
        customFetch<NotificationLog[]>('/api/notification-logs'),
      ]);
      setMail(m);
      setTypes(t.types);
      setSchedules(t.schedules);
      setRules(r);
      setLogs(l);
    } catch (e: any) {
      toast({ title: 'Failed to load notifications', description: e?.message || String(e), variant: 'destructive' as any });
    }
  }, [toast]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const saveMail = async () => {
    if (!mail) return;
    setMailSaving(true);
    try {
      const updated = await customFetch<MailConfig>('/api/mail-config', { method: 'PUT', body: JSON.stringify(mail) });
      setMail(updated);
      toast({ title: 'Mail settings saved' });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || String(e), variant: 'destructive' as any });
    } finally {
      setMailSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testTo) { toast({ title: 'Enter a recipient email' }); return; }
    setTestSending(true);
    try {
      await customFetch('/api/mail-config/test', { method: 'POST', body: JSON.stringify({ to: testTo }) });
      toast({ title: 'Test email sent', description: `Sent to ${testTo}` });
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Test failed', description: e?.message || String(e), variant: 'destructive' as any });
    } finally {
      setTestSending(false);
    }
  };

  const openNewRule = () => {
    const defaultType = types[0];
    setEditing({
      id: 0,
      name: '',
      type: defaultType?.type ?? 'low_stock',
      schedule: 'daily_morning',
      recipients: [],
      threshold: defaultType?.defaultThreshold ?? null,
      enabled: true,
      lastRunAt: null, lastStatus: null, lastError: null,
      createdAt: '', updatedAt: '',
    });
    setShowRuleModal(true);
  };
  const openEdit = (r: NotificationRule) => { setEditing({ ...r }); setShowRuleModal(true); };

  const saveRule = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast({ title: 'Name required' }); return; }
    if (editing.recipients.length === 0) { toast({ title: 'Add at least one recipient' }); return; }
    try {
      const body = JSON.stringify({
        name: editing.name, type: editing.type, schedule: editing.schedule,
        recipients: editing.recipients, threshold: editing.threshold, enabled: editing.enabled,
      });
      if (editing.id === 0) {
        await customFetch('/api/notification-rules', { method: 'POST', body });
        toast({ title: 'Rule created' });
      } else {
        await customFetch(`/api/notification-rules/${editing.id}`, { method: 'PATCH', body });
        toast({ title: 'Rule saved' });
      }
      setShowRuleModal(false);
      setEditing(null);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || String(e), variant: 'destructive' as any });
    }
  };

  const toggleRule = async (r: NotificationRule) => {
    try {
      await customFetch(`/api/notification-rules/${r.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !r.enabled }) });
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Toggle failed', description: e?.message || String(e), variant: 'destructive' as any });
    }
  };
  const runNow = async (r: NotificationRule) => {
    try {
      const res = await customFetch<{ ok?: boolean; error?: string }>(`/api/notification-rules/${r.id}/run-now`, { method: 'POST' });
      if (res.ok) toast({ title: 'Sent', description: `Alert "${r.name}" delivered` });
      else toast({ title: 'Send failed', description: res.error || 'Unknown error', variant: 'destructive' as any });
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Run failed', description: e?.message || String(e), variant: 'destructive' as any });
    }
  };
  const doDelete = async () => {
    if (!deleteRule) return;
    try {
      await customFetch(`/api/notification-rules/${deleteRule.id}`, { method: 'DELETE' });
      toast({ title: 'Rule deleted' });
      setDeleteRule(null);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message || String(e), variant: 'destructive' as any });
    }
  };

  if (!mail) return <div className="text-sm text-gray-500">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-gray-200">
        {([
          { id: 'mail', label: 'Mail Setup', icon: Mail },
          { id: 'rules', label: 'Alert Rules', icon: Bell },
          { id: 'logs', label: 'Recent Activity', icon: ScrollText },
        ] as const).map(s => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={`px-3 py-2 text-sm flex items-center gap-2 -mb-px border-b-2 ${active ? 'border-orange-500 text-orange-600 font-semibold' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
              <Icon size={14} />{s.label}
            </button>
          );
        })}
      </div>

      {section === 'mail' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 flex gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <div>
              SMTP credentials are stored in the database. For Gmail, use an <b>App Password</b> (not your account password).
              Common ports: <code>587</code> (STARTTLS, leave SSL off) or <code>465</code> (SSL on).
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Mail size={16} />SMTP Configuration</h3>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={mail.enabled} onChange={e => setMail({ ...mail, enabled: e.target.checked })} />
                <span className={mail.enabled ? 'text-emerald-700 font-semibold' : 'text-gray-500'}>{mail.enabled ? 'Sending enabled' : 'Sending disabled'}</span>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>SMTP Host</Label><Input value={mail.smtpHost} onChange={e => setMail({ ...mail, smtpHost: e.target.value })} placeholder="smtp.gmail.com" /></div>
              <div><Label>Port</Label><Input type="number" value={mail.smtpPort} onChange={e => setMail({ ...mail, smtpPort: Number(e.target.value) })} /></div>
              <div><Label>Username</Label><Input value={mail.smtpUser} onChange={e => setMail({ ...mail, smtpUser: e.target.value })} placeholder="you@example.com" /></div>
              <div><Label>Password / App Password</Label><Input type="password" value={mail.smtpPass} onChange={e => setMail({ ...mail, smtpPass: e.target.value })} placeholder={mail.hasPassword ? '•••••••• (set, leave blank to keep)' : ''} /></div>
              <div><Label>From Email</Label><Input value={mail.fromEmail} onChange={e => setMail({ ...mail, fromEmail: e.target.value })} placeholder="alerts@yourcafe.com" /></div>
              <div><Label>From Name</Label><Input value={mail.fromName} onChange={e => setMail({ ...mail, fromName: e.target.value })} /></div>
              <div className="col-span-2 flex items-center gap-2">
                <input id="ssl" type="checkbox" checked={mail.secure} onChange={e => setMail({ ...mail, secure: e.target.checked })} />
                <label htmlFor="ssl" className="text-sm text-gray-700">Use SSL/TLS (port 465)</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button onClick={saveMail} disabled={mailSaving}>{mailSaving ? 'Saving…' : 'Save settings'}</Button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Send size={16} />Send a test email</h3>
            <p className="text-sm text-gray-600">Verify your SMTP setup by sending a test message.</p>
            <div className="flex gap-2">
              <Input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="recipient@example.com" />
              <Button onClick={sendTest} disabled={testSending || !mail.enabled}>{testSending ? 'Sending…' : 'Send test'}</Button>
            </div>
            {!mail.enabled && <p className="text-xs text-amber-700">Enable sending and save settings first.</p>}
          </div>
        </div>
      )}

      {section === 'rules' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">Schedule automated alerts to be emailed when business events happen.</p>
            <Button onClick={openNewRule} className="flex items-center gap-1"><Plus size={14} />New rule</Button>
          </div>
          {rules.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-500">
              <Bell size={32} className="mx-auto mb-2 text-gray-400" />
              <p className="text-sm">No alert rules yet. Create one to start receiving automated emails.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Name</th>
                    <th className="text-left px-4 py-2.5 font-medium">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium">Schedule</th>
                    <th className="text-left px-4 py-2.5 font-medium">Recipients</th>
                    <th className="text-left px-4 py-2.5 font-medium">Last run</th>
                    <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rules.map(r => {
                    const t = types.find(t => t.type === r.type);
                    const s = schedules.find(s => s.id === r.schedule);
                    return (
                      <tr key={r.id} className={r.enabled ? '' : 'opacity-50'}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{r.name}</div>
                          {r.lastError && <div className="text-xs text-red-600 mt-0.5">{r.lastError}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{t?.label ?? r.type}</td>
                        <td className="px-4 py-3 text-gray-700">{s?.label ?? r.schedule}</td>
                        <td className="px-4 py-3 text-gray-700">{r.recipients.length} recipient{r.recipients.length === 1 ? '' : 's'}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {r.lastRunAt ? (
                            <div>
                              <div>{new Date(r.lastRunAt).toLocaleString()}</div>
                              <div className={`text-xs ${r.lastStatus === 'sent' ? 'text-emerald-600' : 'text-red-600'}`}>{r.lastStatus}</div>
                            </div>
                          ) : <span className="text-gray-400">Never</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-1">
                            <button onClick={() => runNow(r)} title="Send now" className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><Play size={14} /></button>
                            <button onClick={() => toggleRule(r)} title={r.enabled ? 'Disable' : 'Enable'} className={`p-1.5 hover:bg-gray-100 rounded ${r.enabled ? 'text-emerald-600' : 'text-gray-400'}`}><Power size={14} /></button>
                            <button onClick={() => openEdit(r)} title="Edit" className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><Pencil size={14} /></button>
                            <button onClick={() => setDeleteRule(r)} title="Delete" className="p-1.5 hover:bg-red-50 rounded text-red-600"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {section === 'logs' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {logs.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No notifications sent yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">When</th>
                  <th className="text-left px-4 py-2.5 font-medium">Rule</th>
                  <th className="text-left px-4 py-2.5 font-medium">Subject</th>
                  <th className="text-left px-4 py-2.5 font-medium">Recipients</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(l => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5 text-gray-700">{new Date(l.sentAt).toLocaleString()}</td>
                    <td className="px-4 py-2.5">{l.ruleName}<div className="text-xs text-gray-500">{l.trigger}</div></td>
                    <td className="px-4 py-2.5 text-gray-700">{l.subject ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-700">{l.recipientsCount}</td>
                    <td className="px-4 py-2.5">
                      {l.status === 'sent' && <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium"><CheckCircle2 size={12} />Sent</span>}
                      {l.status === 'failed' && <span className="inline-flex items-center gap-1 text-red-700 text-xs font-medium" title={l.error ?? ''}><AlertTriangle size={12} />Failed</span>}
                      {l.status === 'skipped' && <span className="text-gray-500 text-xs">Skipped</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showRuleModal && editing && (
        <Modal isOpen={showRuleModal} onClose={() => { setShowRuleModal(false); setEditing(null); }} title={editing.id === 0 ? 'New alert rule' : 'Edit alert rule'}>
          <RuleEditor editing={editing} setEditing={setEditing} types={types} schedules={schedules} />
          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button onClick={() => { setShowRuleModal(false); setEditing(null); }} variant="outline">Cancel</Button>
            <Button onClick={saveRule}>Save rule</Button>
          </div>
        </Modal>
      )}

      {deleteRule && (
        <Modal isOpen={!!deleteRule} onClose={() => setDeleteRule(null)} title="Delete alert rule">
          <p className="text-sm text-gray-700">Delete <b>{deleteRule.name}</b>? This cannot be undone.</p>
          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button onClick={() => setDeleteRule(null)} variant="outline">Cancel</Button>
            <Button onClick={doDelete} variant="destructive">Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RuleEditor({ editing, setEditing, types, schedules }: {
  editing: NotificationRule;
  setEditing: (r: NotificationRule) => void;
  types: AlertTypeDef[];
  schedules: ScheduleDef[];
}) {
  const [recipientInput, setRecipientInput] = useState('');
  const currentType = types.find(t => t.type === editing.type);
  const addRecipient = () => {
    const e = recipientInput.trim();
    if (!e || !e.includes('@')) return;
    if (editing.recipients.includes(e)) { setRecipientInput(''); return; }
    setEditing({ ...editing, recipients: [...editing.recipients, e] });
    setRecipientInput('');
  };
  const removeRecipient = (e: string) => setEditing({ ...editing, recipients: editing.recipients.filter(x => x !== e) });

  return (
    <div className="space-y-3">
      <div><Label>Rule name</Label><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Morning low stock alert" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Alert type</Label>
          <Select value={editing.type} onChange={e => {
            const t = types.find(x => x.type === e.target.value);
            setEditing({ ...editing, type: e.target.value, threshold: t?.defaultThreshold ?? null });
          }}>
            {types.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
          </Select>
        </div>
        <div>
          <Label>Schedule</Label>
          <Select value={editing.schedule} onChange={e => setEditing({ ...editing, schedule: e.target.value })}>
            {schedules.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </div>
      </div>
      {currentType && <p className="text-xs text-gray-500 -mt-1">{currentType.description}</p>}
      {currentType?.defaultThreshold && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="text-xs font-semibold text-gray-700">Threshold</div>
          {Object.entries(editing.threshold ?? currentType.defaultThreshold).map(([k, v]) => (
            <div key={k} className="grid grid-cols-2 gap-2 items-center">
              <Label>{k}</Label>
              <Input type={typeof v === 'number' ? 'number' : 'text'} value={String(v)} onChange={e => {
                const next = { ...(editing.threshold ?? currentType.defaultThreshold!) };
                next[k] = typeof v === 'number' ? Number(e.target.value) : e.target.value;
                setEditing({ ...editing, threshold: next });
              }} />
            </div>
          ))}
        </div>
      )}
      <div>
        <Label>Recipients</Label>
        <div className="flex gap-2">
          <Input value={recipientInput} onChange={e => setRecipientInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }} placeholder="email@example.com (Enter to add)" />
          <Button onClick={addRecipient} type="button">Add</Button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {editing.recipients.map(e => (
            <span key={e} className="inline-flex items-center gap-1 bg-orange-100 text-orange-800 px-2 py-1 rounded-md text-xs">
              {e}<button onClick={() => removeRecipient(e)} className="hover:text-red-600">×</button>
            </span>
          ))}
          {editing.recipients.length === 0 && <span className="text-xs text-gray-400">No recipients yet.</span>}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm pt-2">
        <input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} />
        <span>Enabled (will fire on schedule)</span>
      </label>
    </div>
  );
}
