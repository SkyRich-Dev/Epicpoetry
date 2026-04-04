import React, { useState, useEffect, useCallback } from 'react';
import { useListCategories, useCreateCategory, useListUom, useGetConfig, useUpdateConfig, useListUsers, useCreateUser, useUpdateUser } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, Badge } from '../components/ui-extras';
import { Settings, Plus, UserPlus, Pencil, Shield, ShieldCheck, Eye, ScrollText, UserCog, FolderCog, Download, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

const TABS = [
  { id: 'config', label: 'Categories & Config', icon: FolderCog },
  { id: 'users', label: 'User Management', icon: UserCog },
  { id: 'audit', label: 'Audit Logs', icon: ScrollText },
] as const;

type TabId = typeof TABS[number]['id'];

const DEFAULT_CONFIG = {
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
  if (role === 'admin') return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700"><ShieldCheck size={12} /> Admin</span>;
  if (role === 'manager') return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700"><Shield size={12} /> Manager</span>;
  return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700"><Eye size={12} /> Viewer</span>;
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
        <div className="space-y-4 py-2">
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

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);

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

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={openCreate}><UserPlus size={18} /> Add User</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {ROLES.map(r => {
          const count = users?.filter(u => u.role === r.value).length || 0;
          return (
            <div key={r.value} className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-foreground">{r.label}s</span>
                <span className="text-2xl font-display font-bold text-primary">{count}</span>
              </div>
              <p className="text-xs text-muted-foreground">{r.description}</p>
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
                  <button onClick={() => openEdit(u)} className="text-muted-foreground hover:text-primary transition-colors">
                    <Pencil size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Add New User"
        footer={<><Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button><Button onClick={handleCreate} disabled={createMut.isPending || !createForm.username || !createForm.password || !createForm.fullName}>Create User</Button></>}>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Username</Label>
              <Input value={createForm.username} onChange={(e: any) => setCreateForm({ ...createForm, username: e.target.value })} placeholder="e.g. staff1" />
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" value={createForm.password} onChange={(e: any) => setCreateForm({ ...createForm, password: e.target.value })} placeholder="Min 6 characters" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-2 mt-2">
              {ROLES.map(r => (
                <label key={r.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${createForm.role === r.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <input type="radio" name="role" value={r.value} checked={createForm.role === r.value} onChange={() => setCreateForm({ ...createForm, role: r.value })} className="mt-1" />
                  <div>
                    <p className="font-medium text-sm">{r.label}</p>
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!editUser} onClose={() => setEditUser(null)} title={`Edit User — ${editUser?.username}`}
        footer={<><Button variant="ghost" onClick={() => setEditUser(null)}>Cancel</Button><Button onClick={handleUpdate} disabled={updateMut.isPending}>Save Changes</Button></>}>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-2 mt-2">
              {ROLES.map(r => (
                <label key={r.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${editForm.role === r.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <input type="radio" name="editRole" value={r.value} checked={editForm.role === r.value} onChange={() => setEditForm({ ...editForm, role: r.value })} className="mt-1" />
                  <div>
                    <p className="font-medium text-sm">{r.label}</p>
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
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
    <div className="space-y-4">
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
      {activeTab === 'audit' && <AuditLogsTab />}
    </div>
  );
}
