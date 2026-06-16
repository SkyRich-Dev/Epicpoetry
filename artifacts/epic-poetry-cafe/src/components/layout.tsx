import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import { getAuthToken } from '../lib/auth-storage';
import {
  LayoutDashboard, Coffee, Users, Package, ShoppingCart, 
  Receipt, FileText, Settings, LogOut, Menu, X, Trash2, 
  FlaskConical, ClipboardList, PackageSearch, Upload, BarChart3,
  Banknote, Wallet, Store, UserCheck, CalendarDays, KeyRound, FileSpreadsheet,
  Sparkles, UserCircle2, Brain, TableIcon, UtensilsCrossed, Lock,
  ClipboardCheck, Clock3, PieChart, ShoppingBag, Bell
} from 'lucide-react';
import { cn, Modal, Button, Input, Label } from './ui-extras';

type NavItem = { name: string; path: string; icon: any; requires?: string };
type NavGroup = { title: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { name: 'Dashboard', path: '/', icon: LayoutDashboard },
      { name: 'Insights', path: '/insights', icon: Sparkles, requires: 'insights.view' },
      { name: 'Decision Engine', path: '/decision', icon: Brain, requires: 'decision_engine.view' },
    ]
  },
  {
    title: 'Front of House',
    items: [
      { name: 'Table Management', path: '/tables', icon: TableIcon, requires: 'tables.view' },
      { name: 'Kitchen Orders (KOT)', path: '/kot', icon: UtensilsCrossed, requires: 'kot.view' },
      { name: 'Sales & Invoices', path: '/sales', icon: Receipt, requires: 'sales.view' },
      { name: 'Settlements', path: '/settlements', icon: Banknote, requires: 'settlements.view' },
      { name: 'Daily Closing (EOD)', path: '/eod', icon: Lock, requires: 'settlements.view' },
    ]
  },
  {
    title: 'Procurement',
    items: [
      { name: 'Purchase Orders', path: '/purchase-orders', icon: ShoppingBag, requires: 'purchases.view' },
      { name: 'Purchases / GRN', path: '/purchases', icon: ShoppingCart, requires: 'purchases.view' },
      { name: 'Vendors', path: '/vendors', icon: Store, requires: 'vendors.view' },
    ]
  },
  {
    title: 'Inventory',
    items: [
      { name: 'Ingredients', path: '/ingredients', icon: Package, requires: 'ingredients.view' },
      { name: 'Stock Overview', path: '/inventory', icon: PackageSearch, requires: 'inventory.view' },
      { name: 'Stocktake', path: '/stocktakes', icon: ClipboardCheck, requires: 'inventory.view' },
      { name: 'Waste Management', path: '/waste', icon: Trash2, requires: 'waste.view' },
    ]
  },
  {
    title: 'Finance',
    items: [
      { name: 'Expenses', path: '/expenses', icon: FileText, requires: 'expenses.view' },
      { name: 'Expense Budgets', path: '/expense-budgets', icon: PieChart, requires: 'expenses.view' },
      { name: 'Petty Cash', path: '/petty-cash', icon: Wallet, requires: 'petty_cash.view' },
    ]
  },
  {
    title: 'Cafe Core',
    items: [
      { name: 'Menu & Recipes', path: '/menu', icon: Coffee, requires: 'menu_items.view' },
      { name: 'Trials & R&D', path: '/trials', icon: FlaskConical, requires: 'menu_items.edit' },
    ]
  },
  {
    title: 'Team',
    items: [
      { name: 'Employees', path: '/employees', icon: Users, requires: 'employees.view' },
      { name: 'Attendance', path: '/attendance', icon: UserCheck, requires: 'attendance.view' },
      { name: 'Time Clock', path: '/timeclock', icon: Clock3, requires: 'attendance.view' },
    ]
  },
  {
    title: 'Admin',
    items: [
      { name: 'Customers', path: '/customers', icon: UserCircle2, requires: 'customers.view' },
      { name: 'Analytics', path: '/analytics', icon: BarChart3, requires: 'reports.view' },
      { name: 'Excel Upload', path: '/upload', icon: Upload },
      { name: 'Reports', path: '/reports', icon: ClipboardList, requires: 'reports.view' },
      { name: 'Masters & Config', path: '/masters', icon: Settings, requires: 'roles.view' },
    ]
  }
];

function getNavForUser(hasPerm: (key: string) => boolean): NavGroup[] {
  return navGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => !item.requires || hasPerm(item.requires)),
    }))
    .filter(group => group.items.length > 0);
}

const BASE = import.meta.env.BASE_URL || '/';

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  const load = async () => {
    try {
      const token = getAuthToken();
      const r = await fetch(`${BASE}api/in-app-notifications?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      const data = await r.json();
      const list = Array.isArray(data) ? data : data.notifications || [];
      setNotifications(list);
      setUnread(list.filter((n: any) => !n.readAt).length);
    } catch {
      // ignore notification polling failures
    }
  };

  useEffect(() => {
    void load();
    const iv = window.setInterval(() => { void load(); }, 60000);
    return () => window.clearInterval(iv);
  }, []);

  const markRead = async (id?: number) => {
    try {
      const token = getAuthToken();
      const url = id ? `${BASE}api/in-app-notifications/${id}/read` : `${BASE}api/in-app-notifications/read-all`;
      await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      await load();
    } catch {
      // ignore mark-read failures
    }
  };

  const TYPE_COLOR: Record<string, string> = {
    critical: 'text-red-600',
    warning: 'text-amber-600',
    info: 'text-blue-600',
  };

  return (
    <div className="relative">
      <button onClick={() => { setOpen(!open); if (!open) void load(); }} className="relative p-2 rounded-xl hover:bg-muted/60 transition-colors">
        <Bell size={18} className="text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="font-semibold text-sm">Notifications {unread > 0 && `(${unread} unread)`}</span>
              {unread > 0 && <button onClick={() => { void markRead(); }} className="text-xs text-primary hover:underline">Mark all read</button>}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">No notifications</p>
              ) : notifications.map((n: any) => (
                <div
                  key={n.id}
                  onClick={() => { void markRead(n.id); }}
                  className={cn('px-4 py-3 border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors', !n.readAt ? 'bg-blue-50/40' : '')}
                >
                  <div className="flex items-start gap-2">
                    <span className={cn('text-xs font-bold mt-0.5', TYPE_COLOR[n.type] || 'text-blue-600')}>
                      {n.type === 'critical' ? '!' : n.type === 'warning' ? '!' : 'i'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      <p className="text-xs text-muted-foreground">{n.body}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                    {!n.readAt && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const ROUTE_MAP: Record<string, string> = {
    vendor: '/vendors',
    ingredient: '/ingredients',
    menu_item: '/menu',
    invoice: '/sales',
    employee: '/employees',
    customer: '/customers',
    purchase_order: '/purchase-orders',
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
        setResults(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (query.length < 2) {
      setResults(null);
      return;
    }
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const token = getAuthToken();
        const r = await fetch(`${BASE}api/search?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) setResults(await r.json());
      } catch {
        // ignore search failures
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const hasResults = !!(results && Object.values(results).some((v: any) => Array.isArray(v) && v.length > 0));
  const icons: Record<string, string> = {
    vendor: 'V',
    ingredient: 'I',
    menu_item: 'M',
    invoice: '#',
    employee: 'E',
    customer: 'C',
    purchase_order: 'P',
  };

  const go = (type: string) => {
    navigate(ROUTE_MAP[type] || '/');
    setOpen(false);
    setQuery('');
    setResults(null);
  };

  return (
    <div className="relative w-72">
      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search... (Ctrl+K)"
          className="w-full h-8 pl-8 pr-3 rounded-xl border border-input bg-muted/40 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring placeholder:text-muted-foreground/60"
        />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 text-xs">⌕</span>
        {loading && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">...</span>}
      </div>
      {open && query.length >= 2 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setResults(null); }} />
          <div className="absolute top-full left-0 mt-1 w-80 bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden max-h-96 overflow-y-auto">
            {!hasResults ? (
              <p className="text-sm text-muted-foreground p-4 text-center">No results for "{query}"</p>
            ) : (
              Object.entries(results)
                .filter(([key, value]) => key !== 'total' && Array.isArray(value) && (value as any[]).length > 0)
                .map(([key, items]) => (
                  <div key={key}>
                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{key.replace(/_/g, ' ')}</div>
                    {(items as any[]).map((item: any) => (
                      <button
                        key={`${item.type || key}-${item.id}`}
                        onClick={() => go(item.type || key.replace(/s$/, ''))}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/60 text-left transition-colors"
                      >
                        <span>{icons[item.type] || '•'}</span>
                        <div>
                          <p className="text-sm font-medium">{item.name}</p>
                          {item.code && <p className="text-xs text-muted-foreground">{item.code}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MobileBottomNav({ hasPerm }: { hasPerm: (key: string) => boolean }) {
  const [location] = useLocation();
  const items = [
    { label: 'Home', path: '/', icon: LayoutDashboard },
    { label: 'Sales', path: '/sales', icon: Receipt, requires: 'sales.view' },
    { label: 'Tables', path: '/tables', icon: TableIcon, requires: 'tables.view' },
    { label: 'Stock', path: '/inventory', icon: PackageSearch, requires: 'inventory.view' },
    { label: 'Reports', path: '/reports', icon: ClipboardList, requires: 'reports.view' },
  ].filter(item => !item.requires || hasPerm(item.requires));

  return (
    <nav className="md:hidden flex items-center justify-around border-t border-border bg-background px-2 py-2">
      {items.map(item => {
        const Icon = item.icon;
        const active = location === item.path;
        return (
          <Link
            key={item.path}
            href={item.path}
            className={cn('flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-all', active ? 'text-primary' : 'text-muted-foreground')}
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout, hasPerm } = useAuth();
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
      const token = getAuthToken();
      const res = await fetch(`${base}api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setPwError(data.error || 'Failed to change password'); }
      else { setPwSuccess(data.message || 'Verification email sent. Confirm the change from your inbox.'); setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); }
    } catch { setPwError('Network error'); }
    setPwSaving(false);
  };

  const toggleMobile = () => setMobileOpen(!mobileOpen);
  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-sidebar text-sidebar-foreground z-20 relative">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}images/platr-logo.png`} alt="Platr" className="h-7 object-contain" />
        </div>
        <button onClick={toggleMobile} className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors text-sidebar-foreground">
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        "fixed md:sticky top-0 left-0 h-screen w-[260px] bg-sidebar text-sidebar-foreground flex-shrink-0 z-30 transition-transform duration-300 ease-in-out flex flex-col border-r border-sidebar-border",
        mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="px-6 py-6 hidden md:flex items-center justify-start border-b border-sidebar-border">
          <img src={`${import.meta.env.BASE_URL}images/platr-logo.png`} alt="Platr" className="h-9 object-contain" />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 md:py-2 custom-scrollbar">
          {getNavForUser(hasPerm).map((group, idx) => (
            <div key={idx} className="mb-6">
              <h3 className="px-3 text-[11px] font-semibold text-sidebar-foreground/40 uppercase tracking-[0.12em] mb-2">
                {group.title}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map(item => {
                  const isActive = location === item.path || (item.path !== '/' && location.startsWith(item.path));
                  return (
                    <li key={item.path}>
                      <Link href={item.path} className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 text-[13px] font-medium",
                        isActive
                          ? "bg-sidebar-primary text-white shadow-sm shadow-sidebar-primary/20"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )} onClick={closeMobile}>
                        <item.icon size={17} className={cn("transition-colors shrink-0", isActive ? "text-white" : "text-sidebar-foreground/55")} />
                        {item.name}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-sidebar-border mt-auto flex-shrink-0">
          <div className="flex items-center justify-between px-2 py-1.5 gap-2">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                {(user?.fullName || user?.username || 'U').slice(0, 1).toUpperCase()}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-semibold text-sidebar-foreground truncate">{user?.fullName || 'User'}</span>
                <span className="text-[11px] text-sidebar-foreground/55 capitalize">{user?.role || 'Staff'}</span>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={() => { setPwModal(true); setPwError(''); setPwSuccess(''); }} className="p-2 rounded-lg text-sidebar-foreground/55 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-all duration-150" title="Change Password">
                <KeyRound size={15} />
              </button>
              <button onClick={logout} className="p-2 rounded-lg text-sidebar-foreground/55 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-all duration-150" title="Logout">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-20 md:hidden animate-in fade-in duration-200" onClick={closeMobile} />
      )}

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden bg-background">
        <div className="hidden md:flex items-center gap-3 px-6 py-2 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
          <GlobalSearch />
          <div className="flex-1" />
          <NotificationBell />
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 custom-scrollbar">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
          <footer className="text-center text-[11px] text-muted-foreground/60 py-6 mt-10">
            Powered by Platr
          </footer>
        </div>
        <MobileBottomNav hasPerm={hasPerm} />
      </main>

      <Modal isOpen={pwModal} onClose={() => setPwModal(false)} title="Change Password"
        footer={<><Button variant="ghost" onClick={() => setPwModal(false)}>Cancel</Button><Button onClick={handleChangePassword} disabled={pwSaving}>{pwSaving ? 'Saving...' : 'Change Password'}</Button></>}>
        <div className="space-y-4 py-2">
          {pwError && <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm border border-red-200/50">{pwError}</div>}
          {pwSuccess && <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm border border-emerald-200/50">{pwSuccess}</div>}
          <div><Label>Current Password</Label><Input type="password" value={pwForm.currentPassword} onChange={(e: any) => setPwForm({...pwForm, currentPassword: e.target.value})} placeholder="Enter current password" /></div>
          <div><Label>New Password</Label><Input type="password" value={pwForm.newPassword} onChange={(e: any) => setPwForm({...pwForm, newPassword: e.target.value})} placeholder="Min 6 characters" /></div>
          <div><Label>Confirm New Password</Label><Input type="password" value={pwForm.confirmPassword} onChange={(e: any) => setPwForm({...pwForm, confirmPassword: e.target.value})} placeholder="Re-enter new password" /></div>
          <p className="text-xs text-muted-foreground">We&apos;ll send a verification email before the password change is applied.</p>
        </div>
      </Modal>
    </div>
  );
}
