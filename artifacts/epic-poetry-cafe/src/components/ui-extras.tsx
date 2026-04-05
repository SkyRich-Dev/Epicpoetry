import React, { useState } from 'react';
import { X, CalendarDays, RotateCcw, ShieldCheck, ShieldX } from 'lucide-react';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { customFetch } from '@workspace/api-client-react/custom-fetch';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '₹0.00';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '0.00';
  return value.toFixed(2);
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function PageHeader({ title, description, children }: { title: string, description?: string, children?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </div>
  );
}

export function StatCard({ title, value, icon: Icon, trend, trendLabel, colorClass = "text-primary" }: any) {
  return (
    <div className="bg-card rounded-2xl p-6 border border-border/50 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
      <div className="absolute -right-6 -top-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-500">
        <Icon size={120} />
      </div>
      <div className="flex justify-between items-start mb-4 relative z-10">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className={cn("p-2 rounded-xl bg-muted", colorClass)}>
          <Icon size={20} />
        </div>
      </div>
      <div className="relative z-10">
        <h3 className="text-3xl font-numbers font-bold text-foreground tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</h3>
        {trend && (
          <p className="text-xs mt-2 flex items-center gap-1">
            <span className={cn("font-medium", trend > 0 ? "text-emerald-600" : "text-rose-600")}>
              {trend > 0 ? '+' : ''}{trend}%
            </span>
            <span className="text-muted-foreground">{trendLabel}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function Modal({ isOpen, onClose, title, children, maxWidth = "max-w-md", footer }: any) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose} />
      <div className={cn("bg-card text-card-foreground w-full rounded-2xl shadow-2xl overflow-hidden relative z-10 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200", maxWidth)}>
        <div className="px-6 py-4 border-b flex items-center justify-between bg-muted/30">
          <h2 className="text-xl font-display font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors">
            <X size={20}/>
          </button>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
          {children}
        </div>
        {footer && (
          <div className="px-6 py-4 border-t bg-muted/30 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Button({ children, variant = 'primary', className, ...props }: any) {
  const base = "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-all duration-200 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]";
  const variants = {
    primary: "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:bg-primary/90",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    outline: "border-2 border-border bg-transparent hover:bg-muted text-foreground",
    ghost: "bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground",
    danger: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
  };
  return (
    <button className={cn(base, variants[variant as keyof typeof variants], className)} {...props}>
      {children}
    </button>
  );
}

export function Input({ className, onInput, ...props }: any) {
  const handleInput = (e: any) => {
    if (props.type === "number" && e.target.value) {
      const raw = e.target.value;
      const cleaned = raw.replace(/^0+(?=\d)/, '');
      if (raw !== cleaned) {
        e.target.value = cleaned;
      }
    }
    onInput?.(e);
  };
  return (
    <input 
      className={cn("flex h-11 w-full rounded-xl border border-input bg-background px-4 py-2 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50", className)} 
      onInput={handleInput}
      {...props} 
    />
  );
}

export function Select({ className, children, ...props }: any) {
  return (
    <select 
      className={cn("flex h-11 w-full rounded-xl border border-input bg-background px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none", className)} 
      {...props} 
    >
      {children}
    </select>
  );
}

export function Label({ className, children, ...props }: any) {
  return <label className={cn("block text-sm font-medium text-foreground mb-1.5", className)} {...props}>{children}</label>;
}

export function DateFilter({ fromDate, toDate, onChange }: { fromDate: string; toDate: string; onChange: (from: string, to: string) => void }) {
  const today = new Date().toISOString().split('T')[0];
  const setPreset = (days: number) => {
    const to = today;
    const from = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    onChange(from, to);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-muted/50 rounded-xl border border-border">
      <CalendarDays size={16} className="text-muted-foreground" />
      <Input type="date" max={today} value={fromDate} onChange={(e: any) => onChange(e.target.value, toDate)} className="w-[150px] h-9 text-sm" />
      <span className="text-muted-foreground text-sm">to</span>
      <Input type="date" max={today} value={toDate} onChange={(e: any) => onChange(fromDate, e.target.value)} className="w-[150px] h-9 text-sm" />
      <div className="flex gap-1 ml-2">
        <button onClick={() => onChange(today, today)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-background border border-border hover:bg-accent transition-colors">Today</button>
        <button onClick={() => setPreset(7)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-background border border-border hover:bg-accent transition-colors">7D</button>
        <button onClick={() => setPreset(30)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-background border border-border hover:bg-accent transition-colors">30D</button>
        <button onClick={() => setPreset(90)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-background border border-border hover:bg-accent transition-colors">90D</button>
      </div>
      {(fromDate || toDate) && (
        <button onClick={() => onChange('', '')} className="ml-1 p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors" title="Clear filter">
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  );
}

export function VerifyBadge({ verified }: { verified: boolean }) {
  if (!verified) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
      <ShieldCheck size={12} /> Verified
    </span>
  );
}

export function VerifyButton({ verified, isAdmin, onVerify, onUnverify }: { verified: boolean; isAdmin: boolean; onVerify: () => void; onUnverify: () => void }) {
  if (!isAdmin) return verified ? <VerifyBadge verified={true} /> : null;
  return verified ? (
    <button onClick={onUnverify} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 hover:bg-rose-500/10 hover:text-rose-700 hover:border-rose-500/20 transition-colors" title="Click to unverify">
      <ShieldCheck size={12} /> Verified
    </button>
  ) : (
    <button onClick={onVerify} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-muted text-muted-foreground border border-border hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-colors" title="Click to verify">
      <ShieldX size={12} /> Unverified
    </button>
  );
}

export async function apiVerify(module: string, id: number): Promise<void> {
  const base = import.meta.env.BASE_URL || '/';
  await customFetch(`${base}api/${module}/${id}/verify`, { method: 'PATCH' });
}

export async function apiUnverify(module: string, id: number): Promise<void> {
  const base = import.meta.env.BASE_URL || '/';
  await customFetch(`${base}api/${module}/${id}/unverify`, { method: 'PATCH' });
}

export function Badge({ children, variant = 'default', className }: any) {
  const variants = {
    default: "bg-primary/10 text-primary border border-primary/20",
    success: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-700 border border-amber-500/20",
    danger: "bg-rose-500/10 text-rose-700 border border-rose-500/20",
    neutral: "bg-muted text-muted-foreground border border-border",
  };
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium", variants[variant as keyof typeof variants], className)}>
      {children}
    </span>
  );
}
