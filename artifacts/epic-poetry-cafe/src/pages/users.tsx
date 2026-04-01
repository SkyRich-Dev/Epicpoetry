import React, { useState } from 'react';
import { useListUsers, useCreateUser, useUpdateUser } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, Badge } from '../components/ui-extras';
import { Plus, UserPlus, Pencil, Shield, ShieldCheck, Eye } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

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

export default function UsersPage() {
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
    <div className="space-y-6">
      <PageHeader title="User Management" description="Create and manage user accounts with role-based access">
        <Button onClick={openCreate}><UserPlus size={18} /> Add User</Button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
    </div>
  );
}
