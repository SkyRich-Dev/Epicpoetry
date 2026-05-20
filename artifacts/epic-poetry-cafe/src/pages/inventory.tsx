import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useGetStockOverview, useSaveStockSnapshot, useListCategories } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, Badge, useClientPagination, TablePagination } from '../components/ui-extras';
import { PackageSearch, AlertCircle, Save, Search, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '../lib/auth';

const UNCATEGORIZED = '__uncategorized__';

export default function Inventory() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPerm } = useAuth();
  const canAdjust = hasPerm('inventory.edit');
  const { data: stock, isLoading } = useGetStockOverview();
  const { data: categories } = useListCategories({ type: 'ingredient' });
  const saveMut = useSaveStockSnapshot();

  // ----- main page filters -----
  const [search, setSearch] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState<number | 'all' | 'low'>('all');
  const [sortBy, setSortBy] = useState<'name-asc' | 'name-desc' | 'stock-asc' | 'stock-desc' | 'category' | 'status'>('name-asc');

  const filteredStock = useMemo(() => {
    if (!stock) return [];
    const q = search.trim().toLowerCase();
    let rows = (stock as any[]).filter((s: any) => {
      if (filterCategoryId === 'low') {
        if (!s.lowStock) return false;
      } else if (filterCategoryId !== 'all') {
        if ((s.categoryId ?? null) !== filterCategoryId) return false;
      }
      if (!q) return true;
      return s.ingredientName?.toLowerCase().includes(q);
    });
    rows = [...rows].sort((a: any, b: any) => {
      switch (sortBy) {
        case 'name-asc': return (a.ingredientName || '').localeCompare(b.ingredientName || '');
        case 'name-desc': return (b.ingredientName || '').localeCompare(a.ingredientName || '');
        case 'stock-asc': return (a.currentStock || 0) - (b.currentStock || 0);
        case 'stock-desc': return (b.currentStock || 0) - (a.currentStock || 0);
        case 'category': return (a.categoryName || 'zzzz').localeCompare(b.categoryName || 'zzzz') || (a.ingredientName || '').localeCompare(b.ingredientName || '');
        case 'status': return Number(!!b.lowStock) - Number(!!a.lowStock) || (a.ingredientName || '').localeCompare(b.ingredientName || '');
        default: return 0;
      }
    });
    return rows;
  }, [stock, search, filterCategoryId, sortBy]);
  const inventoryPagination = useClientPagination(filteredStock, 5);

  // ----- End of Day Physical Count modal -----
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState(new Date().toISOString().split('T')[0]);
  // The "baseline" is what every input was set to when the modal was last
  // (re)opened or saved. Anything different from baseline = unsaved edits.
  const [snapshotBaseline, setSnapshotBaseline] = useState<Record<number, number>>({});
  const [snapshotLines, setSnapshotLines] = useState<Record<number, number>>({});
  const [modalSearch, setModalSearch] = useState('');
  const [modalCategory, setModalCategory] = useState<number | 'all' | 'edited'>('all');
  const [confirmClose, setConfirmClose] = useState(false);
  const firstSearchInputRef = useRef<HTMLInputElement | null>(null);

  // Reset filters every time the modal opens, and pre-load all current stock
  // values so the operator can simply confirm the lines that haven't changed.
  const openSnapshot = () => {
    const initial: Record<number, number> = {};
    stock?.forEach(s => { initial[s.ingredientId] = s.currentStock; });
    setSnapshotBaseline(initial);
    setSnapshotLines(initial);
    setSnapshotDate(new Date().toISOString().split('T')[0]);
    setModalSearch('');
    setModalCategory('all');
    setConfirmClose(false);
    setIsSnapshotOpen(true);
  };

  // Auto-focus the search box when the modal opens, so the operator can
  // start typing the ingredient name immediately.
  useEffect(() => {
    if (isSnapshotOpen) {
      const id = setTimeout(() => firstSearchInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [isSnapshotOpen]);

  // editedIds = lines whose value differs from the baseline (i.e. unsaved edits)
  const editedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const [k, v] of Object.entries(snapshotLines)) {
      const id = Number(k);
      const base = snapshotBaseline[id];
      // A safe equality check that tolerates the float roundtrip
      if (Math.abs((Number(v) || 0) - (Number(base) || 0)) > 1e-6) ids.add(id);
    }
    return ids;
  }, [snapshotLines, snapshotBaseline]);

  const isDirty = editedIds.size > 0;

  // Group + filter stock for the modal list (search, category filter, only-edited filter)
  const groupedForModal = useMemo(() => {
    if (!stock) return [] as { categoryId: string; categoryName: string; items: any[] }[];
    const q = modalSearch.trim().toLowerCase();
    const filtered = (stock as any[]).filter((s: any) => {
      if (modalCategory === 'edited') {
        if (!editedIds.has(s.ingredientId)) return false;
      } else if (modalCategory !== 'all') {
        if ((s.categoryId ?? null) !== modalCategory) return false;
      }
      if (!q) return true;
      return s.ingredientName?.toLowerCase().includes(q);
    });
    const buckets = new Map<string, { categoryId: string; categoryName: string; items: any[] }>();
    for (const s of filtered) {
      const key = s.categoryId == null ? UNCATEGORIZED : String(s.categoryId);
      const name = s.categoryName || 'Uncategorised';
      const bucket = buckets.get(key) || { categoryId: key, categoryName: name, items: [] };
      bucket.items.push(s);
      buckets.set(key, bucket);
    }
    return Array.from(buckets.values())
      .map(b => ({ ...b, items: b.items.sort((a, b) => (a.ingredientName || '').localeCompare(b.ingredientName || '')) }))
      .sort((a, b) => {
        // Uncategorised always last
        if (a.categoryId === UNCATEGORIZED) return 1;
        if (b.categoryId === UNCATEGORIZED) return -1;
        return a.categoryName.localeCompare(b.categoryName);
      });
  }, [stock, modalSearch, modalCategory, editedIds]);

  const totalVisible = useMemo(() => groupedForModal.reduce((n, g) => n + g.items.length, 0), [groupedForModal]);

  // ---- close-handling: never just discard unsaved edits silently ----
  const requestClose = () => {
    if (isDirty) { setConfirmClose(true); return; }
    setIsSnapshotOpen(false);
  };

  const discardAndClose = () => {
    setConfirmClose(false);
    setIsSnapshotOpen(false);
  };

  const cancelCloseAttempt = () => setConfirmClose(false);

  const handleSaveSnapshot = async (closeAfter: boolean) => {
    try {
      // Only send rows the operator actually touched — keeps the snapshot
      // payload small and the audit trail honest.
      const items = Array.from(editedIds).map((id) => ({
        ingredientId: Number(id),
        closingQty: Number(snapshotLines[id]) || 0,
      }));
      if (items.length === 0 && closeAfter) {
        // Nothing to save — just close.
        setConfirmClose(false);
        setIsSnapshotOpen(false);
        return;
      }
      if (items.length === 0) {
        toast({ title: 'No changes to save', description: 'Edit at least one ingredient quantity first.' });
        return;
      }
      await saveMut.mutateAsync({ data: { snapshotDate, items } });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/stock-overview'] });
      // Reset baseline = saved values so the modal is no longer "dirty",
      // but stay open so the operator can keep counting more sections.
      setSnapshotBaseline({ ...snapshotLines });
      setConfirmClose(false);
      toast({
        title: closeAfter ? 'Stock snapshot saved' : 'Saved — keep counting',
        description: `${items.length} ingredient${items.length === 1 ? '' : 's'} updated.`,
      });
      if (closeAfter) setIsSnapshotOpen(false);
    } catch (e: any) {
      toast({ title: 'Failed to save snapshot', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory Overview" description="Real-time theoretical stock levels based on purchases and sales">
        {canAdjust && <Button onClick={openSnapshot}><PackageSearch size={18}/> End of Day Count</Button>}
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3" data-testid="inventory-filters">
        <div className="flex-1 min-w-[220px]">
          <Label>Search</Label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              data-testid="input-search-inventory"
              className="pl-9"
              placeholder="Search ingredient..."
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="w-56">
          <Label>Category</Label>
          <Select
            data-testid="select-filter-category"
            value={String(filterCategoryId)}
            onChange={(e: any) => {
              const v = e.target.value;
              setFilterCategoryId(v === 'all' || v === 'low' ? v : Number(v));
            }}
          >
            <option value="all">All categories</option>
            <option value="low">Low stock only</option>
            {categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div className="w-56">
          <Label>Sort by</Label>
          <Select
            data-testid="select-sort-by"
            value={sortBy}
            onChange={(e: any) => setSortBy(e.target.value as any)}
          >
            <option value="name-asc">Name (A &rarr; Z)</option>
            <option value="name-desc">Name (Z &rarr; A)</option>
            <option value="stock-asc">Stock (low &rarr; high)</option>
            <option value="stock-desc">Stock (high &rarr; low)</option>
            <option value="category">Category</option>
            <option value="status">Status (low stock first)</option>
          </Select>
        </div>
      </div>

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Ingredient</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4 text-right">Current Stock</th>
              <th className="px-6 py-4">UOM</th>
              <th className="px-6 py-4 text-right">Reorder Lvl</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-right">Stock Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border" data-testid="inventory-table-body">
            {isLoading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading stock...</td></tr>
            ) : filteredStock.length === 0 ? (
               <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No ingredients match your filters.</td></tr>
            ) : inventoryPagination.paginatedRows.map((s: any) => (
              <tr key={s.ingredientId} className="table-row-hover">
                <td className="px-6 py-4 font-medium text-foreground">{s.ingredientName}</td>
                <td className="px-6 py-4 text-muted-foreground">{s.categoryName || '-'}</td>
                <td className="px-6 py-4 text-right font-display font-semibold text-base">{s.currentStock.toFixed(2)}</td>
                <td className="px-6 py-4 text-muted-foreground">{s.stockUom}</td>
                <td className="px-6 py-4 text-right text-muted-foreground">{s.reorderLevel}</td>
                <td className="px-6 py-4 text-center">
                  {s.lowStock ? (
                    <Badge variant="danger" className="gap-1"><AlertCircle size={12}/> Low Stock</Badge>
                  ) : (
                    <Badge variant="success">Optimal</Badge>
                  )}
                </td>
                <td className="px-6 py-4 text-right text-muted-foreground">{formatCurrency(s.stockValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <TablePagination {...inventoryPagination} onPageChange={inventoryPagination.setPage} />
      </div>

      <Modal
        isOpen={isSnapshotOpen}
        onClose={requestClose}
        title="End of Day Physical Count"
        maxWidth="max-w-3xl"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground" data-testid="snapshot-edited-count">
              {isDirty
                ? <>You have <strong className="text-foreground">{editedIds.size}</strong> unsaved change{editedIds.size === 1 ? '' : 's'}.</>
                : <>No unsaved changes.</>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={requestClose} data-testid="btn-snapshot-close">Close</Button>
              <Button
                variant="outline"
                onClick={() => handleSaveSnapshot(false)}
                disabled={saveMut.isPending || !isDirty}
                data-testid="btn-snapshot-save-keep-open"
              >
                <Save size={16}/> Save &amp; keep counting
              </Button>
              <Button
                onClick={() => handleSaveSnapshot(true)}
                disabled={saveMut.isPending || !isDirty}
                data-testid="btn-snapshot-save-close"
              >
                <Save size={16}/> Save &amp; close
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5 py-2">
          <div className="bg-transparent p-4 rounded-xl border border-border flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-foreground">Snapshot Date</h4>
              <p className="text-xs text-muted-foreground">Record the actual physical stock to adjust theoretical values.</p>
            </div>
            <Input
              type="date"
              max={new Date().toISOString().split('T')[0]}
              className="w-auto"
              value={snapshotDate}
              onChange={(e: any) => setSnapshotDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="snapshot-filters">
            <div>
              <Label>Search ingredient</Label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  ref={firstSearchInputRef as any}
                  data-testid="input-snapshot-search"
                  className="pl-9 pr-8"
                  placeholder="Type to filter..."
                  value={modalSearch}
                  onChange={(e: any) => setModalSearch(e.target.value)}
                />
                {modalSearch ? (
                  <button
                    type="button"
                    onClick={() => setModalSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    title="Clear search"
                  >
                    <X size={12}/>
                  </button>
                ) : null}
              </div>
            </div>
            <div>
              <Label>Category</Label>
              <Select
                data-testid="select-snapshot-category"
                value={String(modalCategory)}
                onChange={(e: any) => {
                  const v = e.target.value;
                  setModalCategory(v === 'all' || v === 'edited' ? v : Number(v));
                }}
              >
                <option value="all">All categories</option>
                <option value="edited">Show only edited ({editedIds.size})</option>
                {categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          </div>

          <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-2 custom-scrollbar" data-testid="snapshot-list">
            {totalVisible === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground border border-dashed border-border rounded-xl">
                No ingredients match these filters.
              </div>
            ) : groupedForModal.map((group) => (
              <div key={group.categoryId} data-testid={`snapshot-category-${group.categoryId}`}>
                <div className="sticky top-0 z-10 bg-card/95 backdrop-blur px-1 py-1.5 mb-2 flex items-center gap-2 border-b border-border">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                    {group.categoryName}
                  </span>
                  <Badge variant="neutral" className="text-[10px]">{group.items.length}</Badge>
                </div>
                <div className="space-y-2">
                  {group.items.map((s: any) => {
                    const edited = editedIds.has(s.ingredientId);
                    return (
                      <div
                        key={s.ingredientId}
                        className={`flex items-center justify-between p-3 border rounded-xl transition-colors ${
                          edited ? 'border-primary/60 bg-primary/5' : 'border-border/50 bg-card'
                        }`}
                        data-testid={`snapshot-row-${s.ingredientId}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{s.ingredientName}</p>
                          <p className="text-xs text-muted-foreground">
                            Theoretical: {Number(s.currentStock).toFixed(2)} {s.stockUom}
                            {edited ? <span className="ml-2 text-primary font-semibold">• edited</span> : null}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Input
                            type="number"
                            step="0.01"
                            className="w-32 text-right"
                            value={snapshotLines[s.ingredientId] ?? ''}
                            onChange={(e: any) =>
                              setSnapshotLines({ ...snapshotLines, [s.ingredientId]: Number(e.target.value) })
                            }
                          />
                          <span className="text-sm text-muted-foreground w-8">{s.stockUom}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Confirm-on-close: only appears when the operator tries to close
          with unsaved edits. Three explicit choices, never a silent discard. */}
      <Modal
        isOpen={confirmClose}
        onClose={cancelCloseAttempt}
        title="You have unsaved counts"
        maxWidth="max-w-md"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="ghost" onClick={cancelCloseAttempt} data-testid="btn-confirm-keep-editing">
              Keep editing
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={discardAndClose} data-testid="btn-confirm-discard">
                Close without saving
              </Button>
              <Button onClick={() => handleSaveSnapshot(true)} disabled={saveMut.isPending} data-testid="btn-confirm-save">
                <Save size={16}/> Save &amp; close
              </Button>
            </div>
          </div>
        }
      >
        <p className="py-2 text-sm text-muted-foreground">
          You've edited <strong className="text-foreground">{editedIds.size}</strong> ingredient{editedIds.size === 1 ? '' : 's'}.
          Do you want to save these counts before closing?
        </p>
      </Modal>
    </div>
  );
}
