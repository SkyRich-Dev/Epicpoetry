import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import { 
  LayoutDashboard, Coffee, Users, Package, ShoppingCart, 
  Receipt, FileText, Settings, LogOut, Menu, X, Trash2, 
  FlaskConical, ClipboardList, PackageSearch, Upload, BarChart3,
  Banknote, Wallet, UserCog, Store, ScrollText
} from 'lucide-react';
import { cn } from './ui-extras';

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
    title: 'Admin',
    items: [
      { name: 'Analytics', path: '/analytics', icon: BarChart3, adminOnly: true },
      { name: 'Excel Upload', path: '/upload', icon: Upload, adminOnly: true },
      { name: 'Reports', path: '/reports', icon: ClipboardList, adminOnly: true },
      { name: 'User Management', path: '/users', icon: UserCog, adminOnly: true },
      { name: 'Masters & Config', path: '/masters', icon: Settings, adminOnly: true },
      { name: 'Audit Logs', path: '/audit-logs', icon: ScrollText, adminOnly: true },
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

        <div className="p-4 border-t border-sidebar-border mt-auto">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white">{user?.fullName || 'User'}</span>
              <span className="text-xs text-sidebar-foreground/60 capitalize">{user?.role || 'Staff'}</span>
            </div>
            <button onClick={logout} className="p-2 rounded-lg text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent transition-colors" title="Logout">
              <LogOut size={18} />
            </button>
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
        </div>
      </main>
    </div>
  );
}
