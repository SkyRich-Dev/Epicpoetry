import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { PageHeader, Button, Input, Label, formatCurrency } from '../components/ui-extras';
import {
  Download, FileBarChart, FileSpreadsheet, FileText, Loader2, Play, Search, AlertCircle,
  Star, Coffee, Package, IndianRupee, Truck, Wallet, ShoppingBag, Clock,
  ChevronRight, ChevronDown, LayoutGrid, Rows, Printer, Lock,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  REPORT_META, QUICK_REPORTS, RANGE_LABELS, resolveRange,
  type RangePreset, type QuickReport,
} from './reports-meta';

const BASE = import.meta.env.BASE_URL || '/';
const FAVS_KEY = 'epc.reports.favorites.v1';
const RECENTS_KEY = 'epc.reports.recents.v1';
const DENSITY_KEY = 'epc.reports.density.v1';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetchJson<T = any>(path: string): Promise<T> {
  const res = await fetch(`${BASE}api/${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err: any = new Error(text || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function downloadReport(key: string, from: string, to: string, format: 'xlsx' | 'pdf') {
  const params = new URLSearchParams({ from, to, format });
  const res = await fetch(`${BASE}api/reports/run/${encodeURIComponent(key)}?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text() || `Download failed (${res.status})`);
  const blob = await res.blob();
  const ext = format === 'xlsx' ? 'xlsx' : 'pdf';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${key}_${from}_${to}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type RegistryItem = { key: string; title: string; category: string; adminOnly?: boolean };
type ColType = 'text' | 'number' | 'currency' | 'date' | 'percent';
type ReportColumn = { key: string; label: string; type?: ColType; width?: number };
type ReportResult = {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary?: { label: string; value: string | number }[];
  period?: { from: string; to: string; label: string };
};

type RecentItem = { key: string; range: RangePreset; from: string; to: string; runAt: number };

const CATEGORY_ORDER = ['Sales', 'Purchase', 'Inventory', 'Recipe', 'Expense', 'HR', 'Financial', 'Operational'];

const QUICK_ICON: Record<QuickReport['icon'], React.ComponentType<{ size?: number; className?: string }>> = {
  sales: IndianRupee,
  item: Coffee,
  stock: Package,
  pnl: ShoppingBag,
  vendor: Truck,
  expense: Wallet,
};

function fmtCell(v: unknown, type?: ColType): string {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'currency') return formatCurrency(Number(v));
  if (type === 'percent') return `${Number(v).toFixed(2)}%`;
  if (type === 'number') return Number(v).toLocaleString('en-IN');
  return String(v);
}

function loadFavs(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAVS_KEY) || '[]')); } catch { return new Set(); }
}
function saveFavs(set: Set<string>) {
  localStorage.setItem(FAVS_KEY, JSON.stringify(Array.from(set)));
}
function loadRecents(): RecentItem[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; }
}
function pushRecent(item: RecentItem) {
  const list = loadRecents().filter((r) => r.key !== item.key);
  list.unshift(item);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 6)));
}

type Density = 'cozy' | 'compact';

export default function Reports() {
  const { toast } = useToast();
  const [registry, setRegistry] = useState<RegistryItem[] | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<RangePreset | 'custom'>('today');
  const [from, setFrom] = useState<string>(resolveRange('today').from);
  const [to, setTo] = useState<string>(resolveRange('today').to);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [runError, setRunError] = useState<{ status?: number; message: string } | null>(null);
  const [downloading, setDownloading] = useState<'xlsx' | 'pdf' | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavs());
  const [recents, setRecents] = useState<RecentItem[]>(() => loadRecents());
  const [density, setDensity] = useState<Density>(() => {
    const stored = localStorage.getItem(DENSITY_KEY);
    return stored === 'compact' ? 'compact' : 'cozy';
  });
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});

  useEffect(() => {
    localStorage.setItem(DENSITY_KEY, density);
  }, [density]);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<RegistryItem[]>('reports/registry')
      .then((list) => {
        if (cancelled) return;
        setRegistry(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setRegistryError(err?.message ?? 'Could not load report list');
      });
    return () => { cancelled = true; };
  }, []);

  const allCategories = useMemo(() => {
    if (!registry) return [];
    const set = new Set<string>();
    registry.forEach((r) => set.add(r.category));
    return Array.from(set).sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a); const bi = CATEGORY_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });
  }, [registry]);

  // Apply preset whenever it changes (unless 'custom')
  useEffect(() => {
    if (rangePreset === 'custom') return;
    const r = resolveRange(rangePreset);
    setFrom(r.from); setTo(r.to);
  }, [rangePreset]);

  const selected = useMemo(
    () => registry?.find((r) => r.key === selectedKey) ?? null,
    [registry, selectedKey],
  );
  const selectedMeta = selectedKey ? REPORT_META[selectedKey] : undefined;

  const handleSelectReport = useCallback((key: string, presetOverride?: RangePreset) => {
    setSelectedKey(key);
    setResult(null);
    setRunError(null);
    const meta = REPORT_META[key];
    const preset = presetOverride ?? meta?.defaultRange ?? 'today';
    setRangePreset(preset);
    const r = resolveRange(preset);
    setFrom(r.from); setTo(r.to);
    requestAnimationFrame(() => {
      document.getElementById('report-runner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const runReport = useCallback(async (key: string, fromStr: string, toStr: string, preset: RangePreset | 'custom') => {
    setRunning(true); setRunError(null); setResult(null);
    try {
      const params = new URLSearchParams({ from: fromStr, to: toStr, format: 'json' });
      const data = await apiFetchJson<ReportResult>(
        `reports/run/${encodeURIComponent(key)}?${params.toString()}`,
      );
      setResult(data);
      const item: RecentItem = {
        key, range: preset === 'custom' ? '30d' : preset, from: fromStr, to: toStr, runAt: Date.now(),
      };
      pushRecent(item);
      setRecents(loadRecents());
    } catch (err: any) {
      setRunError({ status: err?.status, message: err?.message ?? 'Could not run report' });
    } finally {
      setRunning(false);
    }
  }, []);

  const handleRun = () => {
    if (!selected) return;
    runReport(selected.key, from, to, rangePreset);
  };

  const handleDownload = async (format: 'xlsx' | 'pdf') => {
    if (!selected) return;
    setDownloading(format);
    try {
      await downloadReport(selected.key, from, to, format);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Please try again', variant: 'destructive' });
    } finally {
      setDownloading(null);
    }
  };

  const handleQuick = (q: QuickReport) => {
    if (!registry) return;
    const exists = registry.find((r) => r.key === q.key);
    if (!exists) return;
    setSelectedKey(q.key);
    setRangePreset(q.range);
    const r = resolveRange(q.range);
    setFrom(r.from); setTo(r.to);
    runReport(q.key, r.from, r.to, q.range);
    requestAnimationFrame(() => {
      document.getElementById('report-runner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const toggleFav = (key: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveFavs(next);
      return next;
    });
  };

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => ({ ...prev, [cat]: !(prev[cat] ?? true) }));
  };

  const isFav = (key: string) => favorites.has(key);

  const browseGroups = useMemo(() => {
    if (!registry) return [] as { category: string; items: RegistryItem[] }[];
    const filtered = registry.filter((r) => {
      if (activeCategory !== 'All' && r.category !== activeCategory) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const desc = REPORT_META[r.key]?.description ?? '';
        return (
          r.title.toLowerCase().includes(q) ||
          r.key.toLowerCase().includes(q) ||
          desc.toLowerCase().includes(q)
        );
      }
      return true;
    });
    const map = new Map<string, RegistryItem[]>();
    for (const r of filtered) {
      const arr = map.get(r.category) ?? [];
      arr.push(r);
      map.set(r.category, arr);
    }
    return allCategories
      .filter((c) => map.has(c))
      .map((c) => ({ category: c, items: map.get(c)! }));
  }, [registry, search, activeCategory, allCategories]);

  const favList = useMemo(() => {
    if (!registry) return [];
    return registry.filter((r) => favorites.has(r.key));
  }, [registry, favorites]);

  const recentDetails = useMemo(() => {
    if (!registry) return [];
    return recents
      .map((r) => ({ ...r, def: registry.find((d) => d.key === r.key) }))
      .filter((x) => !!x.def) as (RecentItem & { def: RegistryItem })[];
  }, [registry, recents]);

  const cozy = density === 'cozy';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Reports"
          description="Open a quick report below, or browse by category. Download anything as Excel or PDF."
        />
        <div className="flex items-center gap-1 bg-muted rounded-full p-1">
          <button
            type="button"
            onClick={() => setDensity('cozy')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              cozy ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Cozy view"
          >
            <LayoutGrid size={13} /> Cozy
          </button>
          <button
            type="button"
            onClick={() => setDensity('compact')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              !cozy ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Compact view"
          >
            <Rows size={13} /> Compact
          </button>
        </div>
      </div>

      {registryError ? (
        <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 flex items-start gap-3 text-sm text-destructive">
          <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold mb-0.5">Could not load reports</div>
            <div className="opacity-90">{registryError}</div>
          </div>
        </div>
      ) : !registry ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading reports…
        </div>
      ) : (
        <>
          {/* QUICK REPORTS */}
          <section>
            <SectionTitle eyebrow="One tap" title="Quick reports" subtitle="The reports your team opens most." />
            <div className={`grid gap-3 ${cozy ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-6'}`}>
              {QUICK_REPORTS.map((q) => {
                const def = registry.find((r) => r.key === q.key);
                if (!def) return null;
                const Icon = QUICK_ICON[q.icon];
                return (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => handleQuick(q)}
                    className={`group relative bg-card border border-border rounded-2xl ${cozy ? 'p-4' : 'p-3'} text-left hover:border-primary/60 hover:shadow-md transition flex flex-col gap-2`}
                  >
                    <div className={`${cozy ? 'w-10 h-10' : 'w-8 h-8'} rounded-xl bg-primary/10 text-primary flex items-center justify-center`}>
                      <Icon size={cozy ? 20 : 16} />
                    </div>
                    <div className={`font-semibold text-foreground leading-tight ${cozy ? 'text-sm' : 'text-xs'}`}>
                      {q.label}
                    </div>
                    <div className={`text-muted-foreground ${cozy ? 'text-xs' : 'text-[11px]'}`}>
                      {RANGE_LABELS[q.range]}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* FAVORITES */}
          {favList.length > 0 ? (
            <section>
              <SectionTitle eyebrow="Pinned by you" title="Favorites" subtitle="Tap to set up — or hit Run for the default range." />
              <div className={`grid gap-3 ${cozy ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
                {favList.map((r) => (
                  <ReportCard
                    key={r.key}
                    report={r}
                    cozy={cozy}
                    fav={isFav(r.key)}
                    onToggleFav={() => toggleFav(r.key)}
                    onSelect={() => handleSelectReport(r.key)}
                    onRun={() => {
                      const meta = REPORT_META[r.key];
                      const preset = meta?.defaultRange ?? 'today';
                      const range = resolveRange(preset);
                      setSelectedKey(r.key);
                      setRangePreset(preset);
                      setFrom(range.from); setTo(range.to);
                      runReport(r.key, range.from, range.to, preset);
                      requestAnimationFrame(() => {
                        document.getElementById('report-runner')?.scrollIntoView({ behavior: 'smooth' });
                      });
                    }}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {/* RECENTS */}
          {recentDetails.length > 0 ? (
            <section>
              <SectionTitle eyebrow="Last opened" title="Recent" subtitle="Run again with the same dates." />
              <div className={`grid gap-3 ${cozy ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
                {recentDetails.map((r, i) => (
                  <button
                    key={`${r.key}-${i}`}
                    type="button"
                    onClick={() => {
                      setSelectedKey(r.key);
                      setRangePreset('custom');
                      setFrom(r.from); setTo(r.to);
                      runReport(r.key, r.from, r.to, 'custom');
                      requestAnimationFrame(() => {
                        document.getElementById('report-runner')?.scrollIntoView({ behavior: 'smooth' });
                      });
                    }}
                    className={`bg-card border border-border rounded-2xl ${cozy ? 'p-4' : 'p-3'} text-left hover:border-primary/60 hover:shadow-md transition group`}
                  >
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                      <Clock size={12} /> {timeAgo(r.runAt)}
                    </div>
                    <div className={`font-semibold text-foreground leading-tight ${cozy ? 'text-sm' : 'text-xs'} mb-1`}>
                      {r.def.title}
                    </div>
                    <div className={`text-muted-foreground ${cozy ? 'text-xs' : 'text-[11px]'}`}>
                      {r.from === r.to ? r.from : `${r.from} → ${r.to}`}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {/* RUNNER (appears after selecting) */}
          {selected ? (
            <section id="report-runner" className="scroll-mt-4">
              <div className={`bg-card border border-border rounded-2xl shadow-sm ${cozy ? 'p-6' : 'p-4'} space-y-5`}>
                <div className="flex items-start gap-4">
                  <div className={`${cozy ? 'w-12 h-12' : 'w-10 h-10'} bg-primary/10 text-primary rounded-xl flex items-center justify-center flex-shrink-0`}>
                    <FileBarChart size={cozy ? 22 : 18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
                      {selected.category}
                      {selected.adminOnly ? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Lock size={11} /> Admin only
                        </span>
                      ) : null}
                    </div>
                    <h2 className={`font-display font-bold text-foreground ${cozy ? 'text-xl md:text-2xl' : 'text-lg'}`}>
                      {selected.title}
                    </h2>
                    {selectedMeta?.description ? (
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        {selectedMeta.description}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleFav(selected.key)}
                    className={`p-2 rounded-lg hover:bg-muted transition ${isFav(selected.key) ? 'text-amber-500' : 'text-muted-foreground'}`}
                    title={isFav(selected.key) ? 'Unpin from favorites' : 'Pin to favorites'}
                  >
                    <Star size={18} fill={isFav(selected.key) ? 'currentColor' : 'none'} />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(['today', 'yesterday', '7d', '30d', '90d', 'mtd', 'last-month', 'qtd', 'fytd'] as RangePreset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setRangePreset(p)}
                      className={`text-xs px-3 py-1.5 rounded-full font-semibold transition ${
                        rangePreset === p
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-muted text-muted-foreground hover:bg-muted/70'
                      }`}
                    >
                      {RANGE_LABELS[p]}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setRangePreset('custom')}
                    className={`text-xs px-3 py-1.5 rounded-full font-semibold transition ${
                      rangePreset === 'custom'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    Custom…
                  </button>
                </div>

                {rangePreset === 'custom' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label>From date</Label>
                      <Input type="date" value={from} max={to} onChange={(e: any) => setFrom(e.target.value)} />
                    </div>
                    <div>
                      <Label>To date</Label>
                      <Input type="date" value={to} min={from} max={resolveRange('today').to} onChange={(e: any) => setTo(e.target.value)} />
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 inline-flex items-center gap-2">
                    <Clock size={13} /> Showing <strong className="text-foreground">{prettyRange(from, to)}</strong>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 pt-2 border-t border-border">
                  <Button onClick={handleRun} disabled={running} className="h-11 px-5">
                    {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                    {running ? 'Running…' : 'Run report'}
                  </Button>
                  <Button onClick={() => handleDownload('xlsx')} disabled={downloading !== null} variant="outline" className="h-11 px-5">
                    {downloading === 'xlsx' ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                    Excel
                  </Button>
                  <Button onClick={() => handleDownload('pdf')} disabled={downloading !== null} variant="outline" className="h-11 px-5">
                    {downloading === 'pdf' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                    PDF
                  </Button>
                  {result ? (
                    <Button onClick={() => window.print()} variant="outline" className="h-11 px-5">
                      <Printer size={16} /> Print
                    </Button>
                  ) : null}
                </div>
              </div>

              {runError ? (
                <div className="mt-4 bg-destructive/10 border border-destructive/30 rounded-2xl p-4 flex items-start gap-3 text-sm text-destructive">
                  {runError.status === 403 ? (
                    <>
                      <Lock size={18} className="flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold mb-0.5">Admin-only report</div>
                        <div className="opacity-90">Ask the owner to sign in to view this one.</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold mb-0.5">Could not run this report</div>
                        <div className="opacity-90">{runError.message}</div>
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {result ? <div className="mt-4"><ReportPreview result={result} /></div> : null}
            </section>
          ) : null}

          {/* BROWSE */}
          <section>
            <SectionTitle eyebrow={`${registry.length} reports`} title="Browse all reports" subtitle="Tap any report to set it up." />

            <div className="bg-card border border-border rounded-2xl p-4 mb-4 space-y-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search reports by name or what they show…"
                  value={search}
                  onChange={(e: any) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <CategoryPill label="All" active={activeCategory === 'All'} onClick={() => setActiveCategory('All')} />
                {allCategories.map((c) => (
                  <CategoryPill key={c} label={c} active={activeCategory === c} onClick={() => setActiveCategory(c)} />
                ))}
              </div>
            </div>

            {browseGroups.length === 0 ? (
              <div className="bg-muted/30 border border-dashed border-border rounded-2xl p-10 text-center">
                <Search className="mx-auto text-muted-foreground mb-3" size={28} />
                <div className="text-sm text-muted-foreground">No reports match your search. Try a different term.</div>
              </div>
            ) : (
              <div className="space-y-4">
                {browseGroups.map(({ category, items }) => {
                  const expanded = expandedCats[category] ?? true;
                  return (
                    <div key={category} className="bg-card border border-border rounded-2xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleCat(category)}
                        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-display font-bold text-foreground">{category}</span>
                          <span className="text-xs text-muted-foreground">{items.length} report{items.length === 1 ? '' : 's'}</span>
                        </div>
                        {expanded ? <ChevronDown size={18} className="text-muted-foreground" /> : <ChevronRight size={18} className="text-muted-foreground" />}
                      </button>
                      {expanded ? (
                        <div className={`grid gap-3 p-4 border-t border-border bg-muted/10 ${cozy ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
                          {items.map((r) => (
                            <ReportCard
                              key={r.key}
                              report={r}
                              cozy={cozy}
                              fav={isFav(r.key)}
                              onToggleFav={() => toggleFav(r.key)}
                              onSelect={() => handleSelectReport(r.key)}
                              onRun={() => {
                                const meta = REPORT_META[r.key];
                                const preset = meta?.defaultRange ?? 'today';
                                const range = resolveRange(preset);
                                setSelectedKey(r.key);
                                setRangePreset(preset);
                                setFrom(range.from); setTo(range.to);
                                runReport(r.key, range.from, range.to, preset);
                                requestAnimationFrame(() => {
                                  document.getElementById('report-runner')?.scrollIntoView({ behavior: 'smooth' });
                                });
                              }}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SectionTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-primary">{eyebrow}</div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display font-bold text-foreground text-lg">{title}</h2>
        {subtitle ? <span className="text-sm text-muted-foreground">{subtitle}</span> : null}
      </div>
    </div>
  );
}

function CategoryPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
        active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
      }`}
    >
      {label}
    </button>
  );
}

function ReportCard({
  report, cozy, fav, onToggleFav, onSelect, onRun,
}: {
  report: RegistryItem;
  cozy: boolean;
  fav: boolean;
  onToggleFav: () => void;
  onSelect: () => void;
  onRun: () => void;
}) {
  const meta = REPORT_META[report.key];
  return (
    <div
      className={`bg-card border border-border rounded-xl ${cozy ? 'p-4' : 'p-3'} hover:border-primary/60 hover:shadow-md transition flex flex-col gap-3 group`}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onSelect} className="flex-1 text-left min-w-0">
          <div className={`font-semibold text-foreground leading-tight ${cozy ? 'text-sm' : 'text-xs'}`}>
            {report.title}
          </div>
          {meta?.description ? (
            <div className={`text-muted-foreground mt-1 leading-snug ${cozy ? 'text-xs' : 'text-[11px]'}`}>
              {meta.description}
            </div>
          ) : null}
          {report.adminOnly ? (
            <div className="text-[10px] uppercase tracking-wider font-semibold text-amber-600 mt-1.5 inline-flex items-center gap-1">
              <Lock size={10} /> Admin only
            </div>
          ) : null}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
          className={`p-1.5 rounded-lg hover:bg-muted transition flex-shrink-0 ${fav ? 'text-amber-500' : 'text-muted-foreground opacity-0 group-hover:opacity-100'}`}
          title={fav ? 'Unpin' : 'Pin to favorites'}
        >
          <Star size={14} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border">
        <button
          type="button"
          onClick={onRun}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground font-semibold transition ${cozy ? 'text-xs py-1.5' : 'text-[11px] py-1'}`}
        >
          <Play size={12} /> Run
        </button>
        <button
          type="button"
          onClick={onSelect}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition ${cozy ? 'text-xs px-2.5 py-1.5' : 'text-[11px] px-2 py-1'}`}
        >
          Set up
        </button>
      </div>
    </div>
  );
}

function prettyRange(from: string, to: string): string {
  if (from === to) return formatDateNice(from);
  return `${formatDateNice(from)} → ${formatDateNice(to)}`;
}

function formatDateNice(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ReportPreview({ result }: { result: ReportResult }) {
  const rowCount = result.rows.length;
  const showRows = result.rows.slice(0, 200);
  const truncated = rowCount > showRows.length;

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-display font-bold text-foreground">{result.title}</div>
          {result.period?.label ? (
            <div className="text-xs text-muted-foreground mt-0.5">{result.period.label}</div>
          ) : null}
          {result.subtitle ? (
            <div className="text-xs text-muted-foreground mt-0.5">{result.subtitle}</div>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {rowCount.toLocaleString('en-IN')} {rowCount === 1 ? 'row' : 'rows'}
          {truncated ? ` · showing first ${showRows.length}` : ''}
        </div>
      </div>

      {result.summary && result.summary.length > 0 ? (
        <div className="px-5 py-4 border-b border-border bg-muted/20 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {result.summary.map((s, i) => (
            <div key={i}>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                {s.label}
              </div>
              <div className="font-display font-bold text-foreground text-lg leading-tight mt-0.5">
                {typeof s.value === 'number' ? s.value.toLocaleString('en-IN') : s.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {rowCount === 0 ? (
        <div className="p-10 text-center">
          <FileBarChart className="mx-auto text-muted-foreground mb-3" size={28} />
          <div className="font-semibold text-foreground">Nothing to show for this period</div>
          <div className="text-sm text-muted-foreground mt-1">Try a different date range from the chips above.</div>
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-foreground sticky top-0 z-10">
              <tr>
                {result.columns.map((c) => (
                  <th
                    key={c.key}
                    className={`px-3 py-2.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap border-b border-border ${
                      c.type === 'number' || c.type === 'currency' || c.type === 'percent'
                        ? 'text-right'
                        : 'text-left'
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {showRows.map((row, i) => (
                <tr key={i} className={`border-t border-border hover:bg-muted/20 ${i % 2 === 1 ? 'bg-muted/10' : ''}`}>
                  {result.columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 whitespace-nowrap ${
                        c.type === 'number' || c.type === 'currency' || c.type === 'percent'
                          ? 'text-right tabular-nums'
                          : 'text-left'
                      }`}
                    >
                      {fmtCell(row[c.key], c.type)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {truncated ? (
        <div className="px-5 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground flex items-center gap-2">
          <Download size={12} /> Showing first {showRows.length} rows on screen — download Excel or PDF for the full {rowCount.toLocaleString('en-IN')} rows.
        </div>
      ) : null}
    </div>
  );
}
