import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/ui-extras';
import { Cake, Heart, Phone, ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';

const BASE = import.meta.env.BASE_URL || '/';

async function apiFetch(path: string) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${BASE}api/${path}`, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

type Item = { id: number; name: string; phone: string; email?: string; dayOfMonth: number; daysUntil: number };

function relativeLabel(daysUntil: number): { text: string; tone: 'today' | 'past' | 'future' } {
  if (daysUntil === 0) return { text: 'Today', tone: 'today' };
  if (daysUntil < 0) {
    const d = Math.abs(daysUntil);
    return { text: `${d} day${d === 1 ? '' : 's'} ago`, tone: 'past' };
  }
  return { text: `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`, tone: 'future' };
}

export default function Celebrations() {
  const [data, setData] = useState<{ birthdays: Item[]; anniversaries: Item[]; month: number; year: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('customers/reminders/this-month')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const renderList = (items: Item[], type: 'birthday' | 'anniversary') => {
    if (items.length === 0) {
      return <p className="text-sm text-muted-foreground py-6 text-center">No {type === 'birthday' ? 'birthdays' : 'anniversaries'} this month.</p>;
    }
    return (
      <div className="divide-y divide-border">
        {items.map(c => {
          const lbl = relativeLabel(c.daysUntil);
          const past = lbl.tone === 'past';
          const today = lbl.tone === 'today';
          const dayChip = today
            ? 'bg-emerald-100 text-emerald-700'
            : type === 'birthday' ? 'bg-pink-100 text-pink-700' : 'bg-rose-100 text-rose-700';
          const labelChip = today
            ? 'bg-emerald-100 text-emerald-700'
            : past ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700';
          return (
            <div key={c.id} className={`flex items-center justify-between py-3 ${past ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold font-numbers ${dayChip}`}>
                  {c.dayOfMonth}
                </div>
                <div>
                  <p className="font-semibold text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone size={11} /> {c.phone}</p>
                </div>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${labelChip}`}>{lbl.text}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title={`Celebrations — ${monthLabel}`} description="Customer birthdays and anniversaries falling this month, day by day.">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back to Dashboard
        </Link>
      </PageHeader>

      {loading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}
      {error && <div className="text-center py-12 text-rose-600 text-sm">{error}</div>}

      {!loading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Cake className="text-pink-500" size={20} />
              <h3 className="text-lg font-display font-semibold">Birthdays ({data?.birthdays.length ?? 0})</h3>
            </div>
            {renderList(data?.birthdays || [], 'birthday')}
          </div>
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Heart className="text-rose-500" size={20} />
              <h3 className="text-lg font-display font-semibold">Anniversaries ({data?.anniversaries.length ?? 0})</h3>
            </div>
            {renderList(data?.anniversaries || [], 'anniversary')}
          </div>
        </div>
      )}
    </div>
  );
}
