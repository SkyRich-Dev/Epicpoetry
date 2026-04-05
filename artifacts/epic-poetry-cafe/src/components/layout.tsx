import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import { 
  LayoutDashboard, Coffee, Users, Package, ShoppingCart, 
  Receipt, FileText, Settings, LogOut, Menu, X, Trash2, 
  FlaskConical, ClipboardList, PackageSearch, Upload, BarChart3,
  Banknote, Wallet, Store, UserCheck, CalendarDays, KeyRound, FileSpreadsheet
} from 'lucide-react';
import { cn, Modal, Button, Input, Label } from './ui-extras';

type NavItem = { name: string; path: string; icon: any; adminOnly?: boolean };
type NavGroup = { title: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    ]
  },
  {
    title: 'Operations',
    items: [
      { name: 'Sales', path: '/sales', icon: Receipt },
      { name: 'Settlements', path: '/settlements', icon: Banknote },
      { name: 'Purchases', path: '/purchases', icon: ShoppingCart },
      { name: 'Expenses', path: '/expenses', icon: FileText },
      { name: 'Petty Cash', path: '/petty-cash', icon: Wallet },
      { name: 'Waste Management', path: '/waste', icon: Trash2 },
    ]
  },
  {
    title: 'Cafe Core',
    items: [
      { name: 'Menu & Recipes', path: '/menu', icon: Coffee },
      { name: 'Ingredients', path: '/ingredients', icon: Package },
      { name: 'Inventory', path: '/inventory', icon: PackageSearch },
      { name: 'Vendors', path: '/vendors', icon: Store },
      { name: 'Trials & R&D', path: '/trials', icon: FlaskConical, adminOnly: true },
    ]
  },
  {
    title: 'Team',
    items: [
      { name: 'Employees', path: '/employees', icon: Users },
      { name: 'Attendance', path: '/attendance', icon: UserCheck },
    ]
  },
  {
    title: 'Admin',
    items: [
      { name: 'Analytics', path: '/analytics', icon: BarChart3, adminOnly: true },
      { name: 'Excel Upload', path: '/upload', icon: Upload },
      { name: 'Reports', path: '/reports', icon: ClipboardList, adminOnly: true },
      { name: 'Masters & Config', path: '/masters', icon: Settings, adminOnly: true },
    ]
  }
];

function getNavForRole(role: string): NavGroup[] {
  return navGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => !item.adminOnly || role === 'admin'),
    }))
    .filter(group => group.items.length > 0);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pwModal, setPwModal] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const handleChangePassword = async () => {
    setPwError(''); setPwSuccess('');
    if (pwForm.newPassword !== pwForm.confirmPassword) { setPwError('Passwords do not match'); return; }
    if (pwForm.newPassword.length < 6) { setPwError('Password must be at least 6 characters'); return; }
    setPwSaving(true);
    try {
      const base = import.meta.env.BASE_URL || '/';
      const token = localStorage.getItem('token');
      const res = await fetch(`${base}api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setPwError(data.error || 'Failed to change password'); }
      else { setPwSuccess('Password changed successfully!'); setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); }
    } catch { setPwError('Network error'); }
    setPwSaving(false);
  };

  const toggleMobile = () => setMobileOpen(!mobileOpen);
  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-sidebar text-sidebar-foreground z-20 relative shadow-md">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Logo" className="w-8 h-8 rounded-md bg-white p-1" />
          <span className="font-display font-bold text-lg">Epic Poetry</span>
        </div>
        <button onClick={toggleMobile} className="p-2">
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        "fixed md:sticky top-0 left-0 h-screen w-72 bg-sidebar text-sidebar-foreground flex-shrink-0 z-30 transition-transform duration-300 ease-in-out shadow-2xl md:shadow-none flex flex-col",
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="p-6 hidden md:flex items-center gap-4">
          <div className="bg-white p-1.5 rounded-xl shadow-inner">
            <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Logo" className="w-10 h-10 object-contain" />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl tracking-tight text-white">Epic Poetry</h2>
            <p className="text-xs text-sidebar-foreground/70 uppercase tracking-widest font-medium mt-0.5">Cafe Engine</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 md:py-2 custom-scrollbar">
          {getNavForRole(user?.role || 'viewer').map((group, idx) => (
            <div key={idx} className="mb-8">
              <h3 className="px-3 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-3">
                {group.title}
              </h3>
              <ul className="space-y-1">
                {group.items.map(item => {
                  const isActive = location === item.path || (item.path !== '/' && location.startsWith(item.path));
                  return (
                    <li key={item.path}>
                      <Link href={item.path} className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group font-medium text-sm",
                        isActive 
                          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md" 
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )} onClick={closeMobile}>
                        <item.icon size={18} className={cn("transition-colors", isActive ? "text-white" : "text-sidebar-foreground/50 group-hover:text-sidebar-accent-foreground")} />
                        {item.name}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-sidebar-border mt-auto flex-shrink-0">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white">{user?.fullName || 'User'}</span>
              <span className="text-xs text-sidebar-foreground/60 capitalize">{user?.role || 'Staff'}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => { setPwModal(true); setPwError(''); setPwSuccess(''); }} className="flex items-center gap-1 px-2 py-2 rounded-lg text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent transition-colors text-sm" title="Change Password">
                <KeyRound size={16} />
              </button>
              <button onClick={logout} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent transition-colors text-sm" title="Logout">
                <LogOut size={16} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 md:hidden animate-in fade-in" onClick={closeMobile} />
      )}

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 lg:p-10">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
          <footer className="text-center text-xs text-muted-foreground py-4 mt-8 border-t">
            Powered by SkyRich
          </footer>
        </div>
      </main>

      <Modal isOpen={pwModal} onClose={() => setPwModal(false)} title="Change Password"
        footer={<><Button variant="ghost" onClick={() => setPwModal(false)}>Cancel</Button><Button onClick={handleChangePassword} disabled={pwSaving}>{pwSaving ? 'Saving...' : 'Change Password'}</Button></>}>
        <div className="space-y-4 py-2">
          {pwError && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{pwError}</div>}
          {pwSuccess && <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-200">{pwSuccess}</div>}
          <div><Label>Current Password</Label><Input type="password" value={pwForm.currentPassword} onChange={(e: any) => setPwForm({...pwForm, currentPassword: e.target.value})} placeholder="Enter current password" /></div>
          <div><Label>New Password</Label><Input type="password" value={pwForm.newPassword} onChange={(e: any) => setPwForm({...pwForm, newPassword: e.target.value})} placeholder="Min 6 characters" /></div>
          <div><Label>Confirm New Password</Label><Input type="password" value={pwForm.confirmPassword} onChange={(e: any) => setPwForm({...pwForm, confirmPassword: e.target.value})} placeholder="Re-enter new password" /></div>
        </div>
      </Modal>
    </div>
  );
}
