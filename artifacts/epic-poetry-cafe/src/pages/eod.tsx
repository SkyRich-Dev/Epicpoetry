import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader, Button, Input, Label, formatCurrency, cn } from '../components/ui-extras';
import { useAuth } from '../lib/auth';
import { apiGet, apiPost } from '../lib/api';
import { Lock, Unlock, Calculator, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useToast } from '../hooks/use-toast';

function getToday() { return new Date().toISOString().split('T')[0]; }
function r2(n: number) { return Math.round((n || 0) * 100) / 100; }

interface Checklist { unverifiedInvoices: number; settlementDone: boolean; eodStatus: string; canClose: boolean; date: string; }
interface EodRecord {
  id?: number; eodDate: string; status: string;
  totalSalesSystem: number; totalInvoices: number;
  cashSalesSystem: number; cashPhysical: number; cashVariance: number;
  cardSalesSystem: number; cardPhysical: number;
  upiSalesSystem: number; upiPhysical: number;
  pettyCashExpected: number; pettyCashPhysical: number;
  totalExpenses: number; notes?: string; denominations?: Record<string,number>;
}

const DENOMS = ['50','20','10','5','1','0.50','0.10'];

export default function EodPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [date, setDate] = useState(getToday());
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [eod, setEod] = useState<EodRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'checklist'|'cash'|'summary'>('checklist');
  const [denoms, setDenoms] = useState<Record<string,number>>({});
  const [manualCash, setManualCash] = useState('');
  const [cardPhysical, setCardPhysical] = useState('');
  const [upiPhysical, setUpiPhysical] = useState('');
  const [pettyCashPhysical, setPettyCashPhysical] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<EodRecord[]>([]);
  const [unlockReason, setUnlockReason] = useState('');
  const [showUnlock, setShowUnlock] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cl, eodData, hist] = await Promise.all([
        apiGet<Checklist>(`/eod/checklist?date=${date}`),
        apiGet<EodRecord | null>(`/eod?date=${date}`),
        apiGet<EodRecord[]>('/eod'),
      ]);
      setChecklist(cl);
      setEod(eodData || null);
      setHistory(Array.isArray(hist) ? hist.slice(0, 10) : []);
      if (eodData?.denominations) setDenoms(eodData.denominations as Record<string,number>);
    } catch (e: unknown) { toast({ title: (e as Error).message || 'Error loading EOD', variant: 'destructive' }); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const denomTotal = r2(DENOMS.reduce((sum, d) => sum + (Number(d) * (denoms[d] || 0)), 0));

  const initiate = async () => {
    setSaving(true);
    try {
      await apiPost('/eod/initiate', { date });
      toast({ title: 'EOD initiated' }); await load(); setStep('cash');
    } catch (e: unknown) { toast({ title: (e as Error).message, variant: 'destructive' }); }
    setSaving(false);
  };

  const submitCashCount = async () => {
    setSaving(true);
    try {
      const cashPhysicalVal = manualCash ? Number(manualCash) : denomTotal;
      await apiPost('/eod/cash-count', {
        date, denominations: denoms, cashPhysical: cashPhysicalVal,
        cardPhysical: Number(cardPhysical) || 0,
        upiPhysical: Number(upiPhysical) || 0,
        pettyCashPhysical: Number(pettyCashPhysical) || 0,
        notes,
      });
      toast({ title: 'Cash count saved' }); await load(); setStep('summary');
    } catch (e: unknown) { toast({ title: (e as Error).message, variant: 'destructive' }); }
    setSaving(false);
  };

  const approve = async () => {
    setSaving(true);
    try {
      await apiPost('/eod/approve', { date });
      toast({ title: 'EOD approved — day locked ✓' }); await load();
    } catch (e: unknown) { toast({ title: (e as Error).message, variant: 'destructive' }); }
    setSaving(false);
  };

  const unlock = async () => {
    if (!unlockReason) return;
    setSaving(true);
    try {
      await apiPost('/eod/unlock', { date, reason: unlockReason });
      toast({ title: 'Day unlocked' }); setShowUnlock(false); setUnlockReason(''); await load();
    } catch (e: unknown) { toast({ title: (e as Error).message, variant: 'destructive' }); }
    setSaving(false);
  };

  const variantLabel = (v: number) => v > 0 ? 'Over' : v < 0 ? 'Short' : 'Match';
  const variantColor = (v: number) => v === 0 ? 'text-emerald-600' : 'text-red-600';
  const isLocked = eod?.status === 'approved';
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';

  return (
    <div className="space-y-6">
      <PageHeader title="Daily Closing (EOD)" description="End-of-day cash reconciliation and day lock">
        <div className="flex items-center gap-3">
          <input type="date" max={getToday()} value={date} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDate(e.target.value)}
            className="rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          {isLocked && isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setShowUnlock(!showUnlock)}>
              <Unlock className="w-4 h-4 mr-1" />Unlock Day
            </Button>
          )}
        </div>
      </PageHeader>

      {showUnlock && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-800">Unlock locked day — this will be audit logged</p>
          <Input placeholder="Reason for unlocking (required)" value={unlockReason} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setUnlockReason(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={unlock} disabled={saving || !unlockReason} variant="destructive" size="sm">Unlock {date}</Button>
            <Button variant="outline" size="sm" onClick={() => setShowUnlock(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? <div className="text-center py-12 text-muted-foreground">Loading EOD data…</div> : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Step tabs */}
            <div className="flex gap-1 bg-muted/60 rounded-xl p-1 w-fit">
              {(['checklist','cash','summary'] as const).map(s => (
                <button key={s} onClick={() => setStep(s)}
                  className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all',
                    step === s ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {s === 'checklist' ? '1. Checklist' : s === 'cash' ? '2. Cash Count' : '3. Review & Close'}
                </button>
              ))}
            </div>

            {/* Checklist */}
            {step === 'checklist' && (
              <div className="rounded-2xl bg-card border p-6 space-y-4">
                <h3 className="font-semibold text-lg">Pre-EOD Checklist — {date}</h3>
                <div className="space-y-3">
                  <div className={cn('flex items-center gap-3 p-3 rounded-xl border',
                    checklist?.unverifiedInvoices === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
                    {checklist?.unverifiedInvoices === 0
                      ? <CheckCircle className="w-5 h-5 text-emerald-600" />
                      : <XCircle className="w-5 h-5 text-red-600" />}
                    <div>
                      <p className="font-medium text-sm">Invoice Verification</p>
                      <p className="text-xs text-muted-foreground">{checklist?.unverifiedInvoices ?? 0} unverified invoices</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl border bg-blue-50 border-blue-200">
                    <CheckCircle className="w-5 h-5 text-blue-600" />
                    <div>
                      <p className="font-medium text-sm">EOD Status</p>
                      <p className="text-xs text-muted-foreground capitalize">{checklist?.eodStatus || 'Not started'}</p>
                    </div>
                  </div>
                </div>
                {isLocked ? (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <Lock className="w-5 h-5 text-emerald-600" />
                    <p className="font-medium text-emerald-700">Day is locked — EOD complete</p>
                  </div>
                ) : (
                  <Button onClick={initiate} disabled={saving} className="w-full">
                    {saving ? 'Initiating…' : eod ? 'Update & Continue' : 'Initiate EOD & Calculate Totals'}
                  </Button>
                )}
              </div>
            )}

            {/* Cash Count */}
            {step === 'cash' && (
              <div className="rounded-2xl bg-card border p-6 space-y-5">
                <h3 className="font-semibold text-lg">Cash Count — {date}</h3>
                {eod && (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'System Cash', value: eod.cashSalesSystem },
                      { label: 'System Card', value: eod.cardSalesSystem },
                      { label: 'Total Sales', value: eod.totalSalesSystem },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl bg-muted/30 p-3 text-center">
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <p className="font-bold text-lg">{formatCurrency(s.value)}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <Label className="text-sm font-semibold mb-3 block"><Calculator className="w-4 h-4 inline mr-1" />Denomination Count</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {DENOMS.map(d => (
                      <div key={d} className="flex items-center gap-2">
                        <span className="text-sm font-medium w-12 text-right">RM {d}</span>
                        <Input type="number" min={0} placeholder="0"
                          value={denoms[d] || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDenoms(prev => ({ ...prev, [d]: Number(e.target.value) }))}
                          className="text-center" />
                        <span className="text-xs text-muted-foreground w-16 text-right">= {formatCurrency(Number(d) * (denoms[d] || 0))}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 p-3 rounded-xl bg-blue-50 border border-blue-200 flex justify-between items-center">
                    <span className="font-semibold text-blue-700">Denomination Total</span>
                    <span className="font-bold text-xl text-blue-800">{formatCurrency(denomTotal)}</span>
                  </div>
                  <div className="mt-2">
                    <Label className="text-xs text-muted-foreground">Or enter total manually (overrides denomination count)</Label>
                    <Input type="number" placeholder="Manual cash total" value={manualCash} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setManualCash(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Card Collected</Label><Input type="number" placeholder="0.00" value={cardPhysical} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setCardPhysical(e.target.value)} /></div>
                  <div><Label>UPI Collected</Label><Input type="number" placeholder="0.00" value={upiPhysical} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setUpiPhysical(e.target.value)} /></div>
                  <div><Label>Petty Cash Physical</Label><Input type="number" placeholder="0.00" value={pettyCashPhysical} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setPettyCashPhysical(e.target.value)} /></div>
                  <div><Label>Notes</Label><Input placeholder="Any notes…" value={notes} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setNotes(e.target.value)} /></div>
                </div>
                <Button onClick={submitCashCount} disabled={saving} className="w-full">
                  {saving ? 'Saving…' : 'Save Cash Count & Review'}
                </Button>
              </div>
            )}

            {/* Summary */}
            {step === 'summary' && eod && (
              <div className="rounded-2xl bg-card border p-6 space-y-5">
                <h3 className="font-semibold text-lg">EOD Summary — {date}</h3>
                <div className="space-y-2">
                  {[
                    { label: 'Total Sales (System)', sys: eod.totalSalesSystem, phys: null, variance: null, note: `${eod.totalInvoices} verified invoices` },
                    { label: 'Cash', sys: eod.cashSalesSystem, phys: eod.cashPhysical, variance: eod.cashVariance },
                    { label: 'Card', sys: eod.cardSalesSystem, phys: eod.cardPhysical, variance: r2(eod.cardPhysical - eod.cardSalesSystem) },
                    { label: 'UPI', sys: eod.upiSalesSystem, phys: eod.upiPhysical, variance: r2(eod.upiPhysical - eod.upiSalesSystem) },
                    { label: 'Petty Cash', sys: eod.pettyCashExpected, phys: eod.pettyCashPhysical, variance: r2(eod.pettyCashPhysical - eod.pettyCashExpected) },
                    { label: 'Total Expenses', sys: eod.totalExpenses, phys: null, variance: null },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                      <span className="text-sm font-medium">{row.label}</span>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency(row.sys)}</p>
                        {row.phys !== null && <p className="text-xs text-muted-foreground">Physical: {formatCurrency(row.phys as number)}</p>}
                        {row.variance !== null && (
                          <p className={cn('text-xs font-bold', variantColor(row.variance as number))}>
                            {variantLabel(row.variance as number)}: {formatCurrency(Math.abs(row.variance as number))}
                          </p>
                        )}
                        {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                {isLocked ? (
                  <div className="flex items-center gap-2 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                    <Lock className="w-6 h-6 text-emerald-600" />
                    <div>
                      <p className="font-semibold text-emerald-700">Day Locked</p>
                      <p className="text-xs text-muted-foreground">No further entries for {date}</p>
                    </div>
                  </div>
                ) : (
                  <Button onClick={approve} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Lock className="w-4 h-4 mr-2" />{saving ? 'Approving…' : 'Approve EOD & Lock Day'}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* History */}
          <div className="rounded-2xl bg-card border p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Clock className="w-4 h-4" />Recent EOD History</h3>
            <div className="space-y-2">
              {history.length === 0 ? <p className="text-sm text-muted-foreground">No history yet</p> :
                history.map(h => (
                  <div key={h.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{h.eodDate}</p>
                      <p className="text-xs text-muted-foreground">{formatCurrency(h.totalSalesSystem)} sales</p>
                    </div>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                      h.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                      h.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600')}>
                      {h.status}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
