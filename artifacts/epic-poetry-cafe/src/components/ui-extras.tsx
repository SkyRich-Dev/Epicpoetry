import React, { useState, useEffect, useRef } from 'react';
import { X, CalendarDays, RotateCcw, ShieldCheck, ShieldX } from 'lucide-react';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { customFetch } from '@workspace/api-client-react/custom-fetch';
import { useGetConfig } from '@workspace/api-client-react';

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
  const { data: config } = useGetConfig();
  const cafeName = (config as any)?.cafeName?.trim();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        {cafeName && (
          <p className="text-[11px] font-semibold text-primary uppercase tracking-[0.18em] mb-1.5">{cafeName}</p>
        )}
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1.5 text-sm">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </div>
  );
}

export function StatCard({ title, value, icon: Icon, trend, trendLabel, colorClass = "text-primary" }: any) {
  const hasTrend = typeof trend === 'number' && Number.isFinite(trend);
  const trendDisplay = hasTrend ? Math.round(trend) : 0;
  return (
    <div className="bg-card rounded-2xl p-5 border border-border shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group">
      <div className="absolute -right-4 -top-4 opacity-[0.04] group-hover:opacity-[0.07] transition-opacity duration-500">
        <Icon size={100} />
      </div>
      <div className="flex justify-between items-start mb-3 relative z-10">
        <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
        <div className={cn("p-2 rounded-xl bg-muted/70", colorClass)}>
          <Icon size={18} />
        </div>
      </div>
      <div className="relative z-10">
        <h3 className="text-2xl font-numbers font-bold text-foreground tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</h3>
        {hasTrend && (
          <p className="text-xs mt-2 flex items-center gap-1.5">
            <span className={cn("font-semibold px-1.5 py-0.5 rounded-md", trendDisplay > 0 ? "text-emerald-700 bg-emerald-50" : trendDisplay < 0 ? "text-rose-700 bg-rose-50" : "text-muted-foreground bg-muted/60")}>
              {trendDisplay > 0 ? '+' : ''}{trendDisplay}%
            </span>
            <span className="text-muted-foreground">{trendLabel}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// Snapshots formData when a modal opens and reports whether the current
// formData has diverged. Lets a Modal block its own close until the user
// confirms discarding edits. Pass the SAME object you pass into your form
// inputs; nested primitives are fine, Dates / functions are not.
export function useFormDirty(isOpen: boolean, formData: any): boolean {
  const initialRef = useRef<string | null>(null);
  useEffect(() => {
    if (isOpen) {
      try { initialRef.current = JSON.stringify(formData); }
      catch { initialRef.current = null; }
    } else {
      initialRef.current = null;
    }
    // We deliberately only resnapshot on open/close transitions, not on
    // every formData change — that would forever match and never be dirty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  if (!isOpen || initialRef.current === null) return false;
  let current: string;
  try { current = JSON.stringify(formData); } catch { return false; }
  return current !== initialRef.current;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = "max-w-md",
  footer,
  dirty = false,
  confirmDiscardMessage = "You have unsaved changes. Discard them?",
  closeRef,
}: any) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Reset the inline confirm overlay when the modal itself toggles, so a
  // reopened modal never starts on the confirm prompt.
  useEffect(() => {
    if (!isOpen) setConfirmDiscard(false);
  }, [isOpen]);

  const attemptClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose?.();
  };

  // Optional escape-hatch: pages with Cancel buttons inside the body (not in
  // the Modal footer render-prop) need a way to invoke the SAME guarded
  // close logic the X / overlay / ESC use. Assign the latest closure each
  // render so the consumer always reads fresh `dirty` and `onClose`.
  useEffect(() => {
    if (!closeRef) return;
    closeRef.current = attemptClose;
    return () => { if (closeRef.current === attemptClose) closeRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // Intercept ESC. Native Radix dialogs do this for us, but our Modal is a
  // bare div, so without this ESC silently does nothing — which is itself a
  // bug. We handle it here AND apply the dirty-guard at the same time.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't fight nested overlays' ESC handling.
      if (confirmDiscard) { setConfirmDiscard(false); e.stopPropagation(); return; }
      e.stopPropagation();
      attemptClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dirty, confirmDiscard]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={attemptClose}
        data-testid="modal-overlay"
      />
      <div className={cn("bg-card text-card-foreground w-full rounded-2xl shadow-2xl overflow-hidden relative z-10 flex flex-col max-h-[90vh] animate-in zoom-in-95 fade-in duration-200", maxWidth)}>
        <div className="px-6 py-4 border-b border-border/60 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={attemptClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all duration-150"
            data-testid="modal-close-x"
          >
            <X size={18}/>
          </button>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
          {children}
        </div>
        {footer && (
          <div className="px-6 py-3.5 border-t border-border/60 flex justify-end gap-2.5 bg-muted/30">
            {/* Footer can be a ReactNode or a render-prop receiving the
              guarded close (`attemptClose`). Pages should wire their
              "Cancel" button through the render-prop form so the dirty
              prompt fires from Cancel as well. */}
            {typeof footer === 'function' ? footer(attemptClose) : footer}
          </div>
        )}
        {confirmDiscard && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150"
            data-testid="discard-confirm"
            onClick={(e) => { if (e.target === e.currentTarget) setConfirmDiscard(false); }}
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-sm mx-4 animate-in zoom-in-95 duration-150">
              <h3 className="text-base font-semibold text-foreground mb-2">Unsaved changes</h3>
              <p className="text-sm text-muted-foreground mb-5">{confirmDiscardMessage}</p>
              <div className="flex justify-end gap-2.5">
                <button
                  onClick={() => setConfirmDiscard(false)}
                  className="px-4 py-2 text-sm font-medium rounded-xl bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-200"
                  data-testid="btn-keep-editing"
                >
                  Keep editing
                </button>
                <button
                  onClick={() => { setConfirmDiscard(false); onClose?.(); }}
                  className="px-4 py-2 text-sm font-medium rounded-xl bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 transition-all duration-200"
                  data-testid="btn-discard"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Button({ children, variant = 'primary', className, ...props }: any) {
  const base = "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none";
  const variants = {
    primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md active:scale-[0.98]",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.98]",
    outline: "border border-border bg-card hover:bg-muted text-foreground active:scale-[0.98]",
    ghost: "bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground",
    danger: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:scale-[0.98]",
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
      className={cn("flex h-10 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm transition-all duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50", className)} 
      onInput={handleInput}
      {...props} 
    />
  );
}

export function Select({ className, children, ...props }: any) {
  return (
    <select 
      className={cn("flex h-10 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none cursor-pointer", className)} 
      {...props} 
    >
      {children}
    </select>
  );
}

export function Label({ className, children, ...props }: any) {
  return <label className={cn("block text-sm font-medium text-foreground/80 mb-2", className)} {...props}>{children}</label>;
}

export function DateFilter({ fromDate, toDate, onChange, defaultFrom = '', defaultTo = '' }: { fromDate: string; toDate: string; onChange: (from: string, to: string) => void; defaultFrom?: string; defaultTo?: string }) {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const setPreset = (days: number) => {
    const to = today;
    const from = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    onChange(from, to);
  };
  const isAtDefault = fromDate === defaultFrom && toDate === defaultTo;
  const hasDefault = !!(defaultFrom || defaultTo);
  return (
    <div className="flex flex-wrap items-center gap-2.5 p-3 bg-card rounded-xl border border-border">
      <CalendarDays size={16} className="text-muted-foreground" />
      <Input type="date" max={today} value={fromDate} onChange={(e: any) => onChange(e.target.value, toDate)} className="w-[150px] h-9 text-sm" />
      <span className="text-muted-foreground text-xs font-medium">to</span>
      <Input type="date" max={today} value={toDate} onChange={(e: any) => onChange(fromDate, e.target.value)} className="w-[150px] h-9 text-sm" />
      <div className="flex gap-1 ml-1">
        <button onClick={() => onChange(today, today)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-muted hover:bg-accent transition-all duration-150">Today</button>
        <button onClick={() => onChange(yesterday, yesterday)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-muted hover:bg-accent transition-all duration-150">Yesterday</button>
        <button onClick={() => setPreset(7)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-muted hover:bg-accent transition-all duration-150">7D</button>
        <button onClick={() => setPreset(30)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-muted hover:bg-accent transition-all duration-150">30D</button>
        <button onClick={() => setPreset(90)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-muted hover:bg-accent transition-all duration-150">90D</button>
      </div>
      {!isAtDefault && (
        <button onClick={() => onChange(defaultFrom, defaultTo)} className="ml-1 p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-all duration-150" title={hasDefault ? "Reset to default" : "Clear filter"}>
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  );
}

export function VerifyBadge({ verified }: { verified: boolean }) {
  if (!verified) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/50">
      <ShieldCheck size={12} /> Verified
    </span>
  );
}

export function VerifyButton({ verified, isAdmin, onVerify, onUnverify }: { verified: boolean; isAdmin: boolean; onVerify: () => void; onUnverify: () => void }) {
  if (!isAdmin) return verified ? <VerifyBadge verified={true} /> : null;
  return verified ? (
    <button onClick={onUnverify} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/50 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200/50 transition-all duration-200" title="Click to unverify">
      <ShieldCheck size={12} /> Verified
    </button>
  ) : (
    <button onClick={onVerify} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-muted text-muted-foreground border border-border hover:bg-primary/5 hover:text-primary hover:border-primary/20 transition-all duration-200" title="Click to verify">
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
    default: "bg-primary/8 text-primary border border-primary/15",
    success: "bg-emerald-50 text-emerald-700 border border-emerald-200/50",
    warning: "bg-amber-50 text-amber-700 border border-amber-200/50",
    danger: "bg-rose-50 text-rose-700 border border-rose-200/50",
    neutral: "bg-muted text-muted-foreground border border-border",
  };
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium", variants[variant as keyof typeof variants], className)}>
      {children}
    </span>
  );
}
