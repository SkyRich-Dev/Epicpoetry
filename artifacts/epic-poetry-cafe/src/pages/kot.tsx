import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from '../lib/api';
import { PageHeader, Badge, Button, cn } from '../components/ui-extras';
import { useAuth } from '../lib/auth';
import { RefreshCw, Zap, ChefHat, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useToast } from '../hooks/use-toast';


type KotStatus = 'new' | 'preparing' | 'ready' | 'served' | 'cancelled';

interface KotItem {
  id: number; kotId: number; menuItemId: number; menuItemName: string;
  qty: number; modifiers: string; notes?: string; status: KotStatus;
}
interface KotOrder {
  id: number; kotNumber: string; invoiceId?: number; tableId?: number;
  tableName?: string; status: KotStatus; expedite: boolean; notes?: string;
  createdAt: string; items: KotItem[];
}

const STATUS_CONFIG: Record<KotStatus, { label: string; color: string; bg: string; next?: KotStatus; nextLabel?: string }> = {
  new:       { label: 'New',       color: 'text-blue-700',  bg: 'bg-blue-50 border-blue-300',   next: 'preparing', nextLabel: 'Start Preparing' },
  preparing: { label: 'Preparing', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-300', next: 'ready',     nextLabel: 'Mark Ready' },
  ready:     { label: 'Ready',     color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-300', next: 'served', nextLabel: 'Mark Served' },
  served:    { label: 'Served',    color: 'text-gray-500',  bg: 'bg-gray-50 border-gray-200' },
  cancelled: { label: 'Cancelled', color: 'text-red-700',   bg: 'bg-red-50 border-red-200' },
};

function getElapsed(ts: string) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

export default function KotPage() {
  const { hasPerm } = useAuth();
  const { toast } = useToast();
  const [kots, setKots] = useState<KotOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<KotStatus | 'active'>('active');
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/kot-orders').then((r: Response) => r.json());
      setKots(Array.isArray(data) ? data : []);
    } catch { toast({ title: 'Failed to load orders', variant: 'destructive' }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [load]);

  const updateStatus = async (kotId: number, status: KotStatus) => {
    setUpdatingId(kotId);
    try {
      const r = await apiFetch(`/kot-orders/${kotId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setUpdatingId(null);
  };

  const toggleExpedite = async (kotId: number, current: boolean) => {
    try {
      await apiFetch(`/kot-orders/${kotId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expedite: !current }),
      });
      load();
    } catch { toast({ title: 'Failed to update', variant: 'destructive' }); }
  };

  const filtered = kots.filter(k => {
    if (filter === 'active') return ['new','preparing','ready'].includes(k.status);
    return k.status === filter;
  });

  const counts = {
    active: kots.filter(k => ['new','preparing','ready'].includes(k.status)).length,
    new: kots.filter(k => k.status === 'new').length,
    preparing: kots.filter(k => k.status === 'preparing').length,
    ready: kots.filter(k => k.status === 'ready').length,
    served: kots.filter(k => k.status === 'served').length,
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Kitchen Orders (KOT)" description="Live kitchen order tracking">
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </PageHeader>

      {/* Status summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { key: 'active', label: 'Active', count: counts.active, color: 'bg-blue-50 border-blue-200 text-blue-700' },
          { key: 'new', label: 'New', count: counts.new, color: 'bg-blue-50 border-blue-200 text-blue-700' },
          { key: 'preparing', label: 'Preparing', count: counts.preparing, color: 'bg-amber-50 border-amber-200 text-amber-700' },
          { key: 'ready', label: 'Ready', count: counts.ready, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
          { key: 'served', label: 'Served', count: counts.served, color: 'bg-gray-50 border-gray-200 text-gray-600' },
        ].map(s => (
          <button key={s.key} onClick={() => setFilter(s.key as any)}
            className={cn('rounded-2xl border-2 p-3 text-left transition-all', s.color,
              filter === s.key ? 'ring-2 ring-primary ring-offset-1' : 'hover:opacity-80')}>
            <div className="text-2xl font-bold">{s.count}</div>
            <div className="text-xs font-medium mt-0.5">{s.label}</div>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground"><ChefHat className="w-10 h-10 mx-auto mb-2 opacity-30" />Loading orders…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No {filter === 'active' ? 'active' : filter} orders</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.sort((a, b) => (b.expedite ? 1 : 0) - (a.expedite ? 1 : 0) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map(kot => {
            const cfg = STATUS_CONFIG[kot.status];
            const isOld = (Date.now() - new Date(kot.createdAt).getTime()) > 20 * 60 * 1000;
            return (
              <div key={kot.id} className={cn('rounded-2xl border-2 p-4 transition-all', cfg.bg, kot.expedite && 'ring-2 ring-red-400')}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-base">{kot.kotNumber}</p>
                      {kot.expedite && <span className="flex items-center gap-0.5 text-xs text-red-600 font-bold"><Zap className="w-3 h-3" />RUSH</span>}
                    </div>
                    {kot.tableName && <p className="text-xs text-muted-foreground mt-0.5">Table: {kot.tableName}</p>}
                  </div>
                  <div className="text-right">
                    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', cfg.color, cfg.bg)}>{cfg.label}</span>
                    <p className={cn('text-xs mt-1', isOld ? 'text-red-500 font-medium' : 'text-muted-foreground')}>
                      <Clock className="w-3 h-3 inline mr-0.5" />{getElapsed(kot.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 mb-4">
                  {kot.items.map(item => (
                    <div key={item.id} className="flex items-start gap-2 text-sm">
                      <span className="font-bold min-w-[24px]">{item.qty}×</span>
                      <div>
                        <p className="font-medium">{item.menuItemName || `Item #${item.menuItemId}`}</p>
                        {item.modifiers && <p className="text-xs text-muted-foreground">{item.modifiers}</p>}
                        {item.notes && <p className="text-xs italic text-amber-600">↳ {item.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>

                {kot.notes && <p className="text-xs italic text-muted-foreground mb-3 border-t pt-2">{kot.notes}</p>}

                <div className="flex gap-2">
                  {cfg.next && hasPerm('kot.edit') && (
                    <button onClick={() => updateStatus(kot.id, cfg.next!)}
                      disabled={updatingId === kot.id}
                      className={cn('flex-1 text-xs py-2 rounded-xl font-medium transition-all',
                        cfg.next === 'preparing' ? 'bg-amber-500 text-white hover:bg-amber-600' :
                        cfg.next === 'ready' ? 'bg-emerald-500 text-white hover:bg-emerald-600' :
                        'bg-blue-500 text-white hover:bg-blue-600')}>
                      {updatingId === kot.id ? '…' : cfg.nextLabel}
                    </button>
                  )}
                  {hasPerm('kot.edit') && ['new','preparing'].includes(kot.status) && (
                    <button onClick={() => toggleExpedite(kot.id, kot.expedite)}
                      className={cn('px-3 py-2 rounded-xl text-xs font-medium transition-all border',
                        kot.expedite ? 'bg-red-100 border-red-300 text-red-700' : 'border-input text-muted-foreground hover:bg-muted')}>
                      <Zap className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
