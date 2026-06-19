import React, { useState } from 'react';
import { useListPurchases, useListVendors, useListIngredients, useGetPettyCashSummary } from '@workspace/api-client-react';
import { PageHeader, Button, Input, Label, Select, Modal, formatCurrency, Badge, formatDate, DateFilter, VerifyButton, apiVerify, apiUnverify, useFormDirty, useClientPagination, TablePagination } from '../components/ui-extras';
import { Plus, Trash2, Pencil, Eye, Paperclip, X, Download } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useToast } from '@/hooks/use-toast';
import { getAuthToken } from '../lib/auth-storage';

const BASE = import.meta.env.BASE_URL || '/';
const MAX_BILL_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_BILL_ATTACHMENT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];

type PurchaseAttachment = {
  billAttachmentUrl: string | null;
  billAttachmentName: string | null;
  billAttachmentType: string | null;
};

type PurchaseAttachmentPreview = PurchaseAttachment & {
  objectUrl: string;
};

export default function Purchases() {
  const queryClient = useQueryClient();
  const { user, hasPerm } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const isViewer = user?.role === 'viewer';
  const canCreate = hasPerm('purchases.create');
  const canEdit = hasPerm('purchases.edit');
  const canDelete = hasPerm('purchases.delete');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const dateParams = { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  const { data: purchases, isLoading } = useListPurchases(Object.keys(dateParams).length ? dateParams : undefined);
  const { data: vendors } = useListVendors();
  const { data: ingredients } = useListIngredients();
  const { data: pettyCashSummary } = useGetPettyCashSummary();
  
  const { toast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPurchaseId, setEditingPurchaseId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPurchaseDetailLoading, setIsPurchaseDetailLoading] = useState(false);
  const [billAttachmentFile, setBillAttachmentFile] = useState<File | null>(null);
  const [existingBillAttachment, setExistingBillAttachment] = useState<PurchaseAttachment | null>(null);
  const [removeExistingBillAttachment, setRemoveExistingBillAttachment] = useState(false);
  const [billAttachmentError, setBillAttachmentError] = useState('');
  const [previewAttachment, setPreviewAttachment] = useState<PurchaseAttachmentPreview | null>(null);
  
  const [formData, setFormData] = useState({
    purchaseDate: new Date().toISOString().split('T')[0],
    vendorId: 0,
    invoiceNumber: '',
    isPaid: false,
    paymentMode: 'cash' as 'cash' | 'petty_cash' | 'account' | 'upi',
  });

  const [lines, setLines] = useState<any[]>([]);
  const purchaseFormDirty = useFormDirty(isModalOpen, {
    formData,
    lines,
    billAttachmentFileName: billAttachmentFile?.name || '',
    existingBillAttachmentName: existingBillAttachment?.billAttachmentName || '',
    removeExistingBillAttachment,
  });
  const purchasesPagination = useClientPagination(purchases || [], 5);

  const resolveAttachmentUrl = (url?: string | null) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    const basePath = BASE === '/' ? '' : BASE.replace(/\/$/, '');
    return `${basePath}${url}`;
  };

  const validateBillAttachment = (file: File | null) => {
    if (!file) return '';
    if (!ALLOWED_BILL_ATTACHMENT_TYPES.includes(file.type)) {
      return 'Unsupported file format. Supported formats: JPG, JPEG, PNG, PDF.';
    }
    if (file.size > MAX_BILL_ATTACHMENT_SIZE) {
      return 'Bill attachment must be 10 MB or smaller.';
    }
    return '';
  };

  const resetBillAttachmentState = () => {
    setBillAttachmentFile(null);
    setExistingBillAttachment(null);
    setRemoveExistingBillAttachment(false);
    setBillAttachmentError('');
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPurchaseId(null);
    resetBillAttachmentState();
  };

  const closePreviewAttachment = () => {
    if (previewAttachment?.objectUrl && previewAttachment.objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewAttachment.objectUrl);
    }
    setPreviewAttachment(null);
  };

  const openCreate = () => {
    setEditingPurchaseId(null);
    setFormData({ purchaseDate: new Date().toISOString().split('T')[0], vendorId: vendors?.[0]?.id || 0, invoiceNumber: '', isPaid: false, paymentMode: 'cash' });
    setLines([{ ingredientId: 0, quantity: 1, unitRate: 0, taxPercent: 0, expiryDate: '' }]);
    resetBillAttachmentState();
    setIsModalOpen(true);
  };

  const openEdit = (purchaseId: number) => {
    setEditingPurchaseId(purchaseId);
    setLines([]);
    setIsModalOpen(true);
    const token = getAuthToken();
    setIsPurchaseDetailLoading(true);
    fetch(`${BASE}api/purchases/${purchaseId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      })
      .then((detail) => {
        const rawPaymentMode = String(detail.purchase.paymentMode || 'cash').toLowerCase();
        const paymentMode = rawPaymentMode === 'petty_cash' || rawPaymentMode === 'account' || rawPaymentMode === 'upi' ? rawPaymentMode : 'cash';
        setFormData({
          purchaseDate: detail.purchase.purchaseDate,
          vendorId: detail.purchase.vendorId,
          invoiceNumber: detail.purchase.invoiceNumber || '',
          isPaid: detail.purchase.paymentStatus === 'fully_paid',
          paymentMode,
        });
        setExistingBillAttachment({
          billAttachmentUrl: detail.purchase.billAttachmentUrl || null,
          billAttachmentName: detail.purchase.billAttachmentName || null,
          billAttachmentType: detail.purchase.billAttachmentType || null,
        });
        setRemoveExistingBillAttachment(false);
        setBillAttachmentFile(null);
        setBillAttachmentError('');
        setLines((detail.lines || []).map((line: any) => ({
          ingredientId: line.ingredientId,
          quantity: line.quantity,
          purchaseUom: line.purchaseUom || 'unit',
          unitRate: line.unitRate,
          taxPercent: line.taxPercent ?? 0,
          expiryDate: line.expiryDate || '',
        })));
      })
      .catch((e: any) => {
        toast({ title: 'Failed to load purchase', description: e.message, variant: 'destructive' });
        closeModal();
      })
      .finally(() => setIsPurchaseDetailLoading(false));
  };

  const handleBillAttachmentSelected = (file?: File | null) => {
    const nextFile = file || null;
    const error = validateBillAttachment(nextFile);
    setBillAttachmentError(error);
    if (error) {
      setBillAttachmentFile(null);
      return;
    }
    setBillAttachmentFile(nextFile);
    if (nextFile) {
      setRemoveExistingBillAttachment(false);
    }
  };

  const clearSelectedBillAttachment = () => {
    setBillAttachmentFile(null);
    setBillAttachmentError('');
  };

  const openBillAttachment = async (attachment: PurchaseAttachment | null | undefined) => {
    if (!attachment?.billAttachmentUrl) return;
    try {
      const resolvedUrl = resolveAttachmentUrl(attachment.billAttachmentUrl);
      if (/^https?:\/\//i.test(resolvedUrl)) {
        if (attachment.billAttachmentType?.startsWith('image/')) {
          if (previewAttachment?.objectUrl && previewAttachment.objectUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewAttachment.objectUrl);
          }
          setPreviewAttachment({ ...attachment, objectUrl: resolvedUrl });
          return;
        }
        window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      const token = getAuthToken();
      const res = await fetch(resolvedUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (attachment.billAttachmentType?.startsWith('image/')) {
        if (previewAttachment?.objectUrl && previewAttachment.objectUrl.startsWith('blob:')) {
          URL.revokeObjectURL(previewAttachment.objectUrl);
        }
        setPreviewAttachment({ ...attachment, objectUrl });
        return;
      }
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e: any) {
      toast({ title: 'Failed to open bill attachment', description: e.message, variant: 'destructive' });
    }
  };

  const downloadBillAttachment = (attachment: PurchaseAttachment | null | undefined) => {
    if (!attachment?.billAttachmentUrl) return;
    const resolvedUrl = resolveAttachmentUrl(attachment.billAttachmentUrl);
    window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
  };

  const addLine = () => setLines([...lines, { ingredientId: 0, quantity: 1, unitRate: 0, taxPercent: 0, expiryDate: '' }]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: string, val: any) => {
    const newLines = [...lines];
    newLines[idx][field] = val;
    setLines(newLines);
  };

  const calcTotal = () => {
    return lines.reduce((acc, l) => {
      const base = l.quantity * l.unitRate;
      const tax = base * (l.taxPercent / 100);
      return acc + base + tax;
    }, 0);
  };

  const purchaseTotal = calcTotal();
  const availablePettyCashBalance = Number(pettyCashSummary?.currentBalance || 0);
  const isPettyCashPayment = formData.isPaid && formData.paymentMode === 'petty_cash';
  const insufficientPettyCash = isPettyCashPayment && purchaseTotal > availablePettyCashBalance + 0.01;

  const handleSave = async () => {
    if (!formData.vendorId) { toast({ title: 'Please select a vendor', variant: 'destructive' }); return; }
    const incompleteLine = lines.find(l => !l.ingredientId || l.ingredientId <= 0 || !l.quantity || l.quantity <= 0);
    if (incompleteLine) { toast({ title: 'Complete every purchase row', description: 'Each row needs an ingredient and quantity greater than 0.', variant: 'destructive' }); return; }
    const validLines = lines.filter(l => l.ingredientId > 0 && l.quantity > 0);
    if (validLines.length === 0) { toast({ title: 'Add at least one item with quantity', variant: 'destructive' }); return; }
    if (insufficientPettyCash) {
      toast({
        title: 'Insufficient petty cash balance',
        description: `Available: ${formatCurrency(availablePettyCashBalance)}. Required: ${formatCurrency(purchaseTotal)}.`,
        variant: 'destructive',
      });
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    for (const l of validLines) {
      if (l.expiryDate && l.expiryDate < today) {
        toast({ title: 'Expiry date cannot be in the past', variant: 'destructive' });
        return;
      }
    }
    try {
      const payload = {
        purchaseDate: formData.purchaseDate,
        vendorId: formData.vendorId,
        invoiceNumber: formData.invoiceNumber,
        paymentStatus: formData.isPaid ? 'paid' : 'unpaid',
        paymentMode: formData.isPaid ? formData.paymentMode : undefined,
        lines: validLines.map(l => {
          const nextLine = { ...l };
          if (!nextLine.expiryDate) delete nextLine.expiryDate;
          return nextLine;
        }),
        removeBillAttachment: removeExistingBillAttachment,
      };
      const token = getAuthToken();
      setIsSaving(true);
      const form = new FormData();
      form.append('payload', JSON.stringify(payload));
      form.append('removeBillAttachment', String(removeExistingBillAttachment));
      if (billAttachmentFile) {
        form.append('billAttachment', billAttachmentFile);
      }
      const res = await fetch(`${BASE}api/${editingPurchaseId ? `purchases/${editingPurchaseId}` : 'purchases'}`, {
        method: editingPurchaseId ? 'PATCH' : 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash'] });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/expenses'] });
      closeModal();
      toast({ title: editingPurchaseId ? 'Purchase updated' : 'Purchase recorded' });
    } catch (e: any) { toast({ title: 'Failed to save purchase', description: e.message, variant: 'destructive' }); }
    finally { setIsSaving(false); }
  };

  const handleVerify = async (id: number) => {
    await apiVerify('purchases', id);
    queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
  };
  const handleUnverify = async (id: number) => {
    await apiUnverify('purchases', id);
    queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${BASE}api/purchases/${deleteConfirm.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ['/api/purchases'] });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash'] });
      queryClient.invalidateQueries({ queryKey: ['/api/petty-cash/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/expenses'] });
      setDeleteConfirm(null);
      toast({ title: 'Purchase deleted' });
    } catch (e: any) {
      toast({ title: 'Failed to delete purchase', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Purchases" description="Record inward inventory and vendor bills">
        {canCreate && <Button onClick={openCreate}><Plus size={18}/> New Purchase</Button>}
      </PageHeader>

      <DateFilter fromDate={fromDate} toDate={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t); }} />

      <div className="table-container">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground border-b font-medium uppercase text-xs tracking-wider">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">PO Number</th>
              <th className="px-6 py-4">Vendor</th>
              <th className="px-6 py-4">Invoice No</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-right">Total Amount</th>
              <th className="px-6 py-4 text-center">Bill</th>
              <th className="px-6 py-4 text-center">Verified</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">Loading purchases...</td></tr>
            ) : purchases?.length === 0 ? (
               <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">No purchases recorded yet.</td></tr>
            ) : purchasesPagination.paginatedRows.map((p: any) => (
              <tr key={p.id} className="table-row-hover">
                <td className="px-6 py-4 text-foreground font-medium">{formatDate(p.purchaseDate)}</td>
                <td className="px-6 py-4 text-muted-foreground">{p.purchaseNumber}</td>
                <td className="px-6 py-4">{p.vendorName}</td>
                <td className="px-6 py-4 text-muted-foreground">{p.invoiceNumber || '-'}</td>
                <td className="px-6 py-4 text-center">
                  <Badge variant={(p.paymentStatus === 'fully_paid' || p.paymentStatus === 'paid' || p.paymentStatus === 'PAID') ? 'success' : 'warning'}>
                    {p.paymentStatus === 'fully_paid' ? 'Paid' : p.paymentStatus === 'unpaid' ? 'Unpaid' : String(p.paymentStatus || '').replace(/_/g, ' ')}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-right font-medium text-foreground">{formatCurrency(p.totalAmount)}</td>
                <td className="px-6 py-4 text-center">
                  {p.billAttachmentUrl ? (
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => openBillAttachment({
                          billAttachmentUrl: p.billAttachmentUrl,
                          billAttachmentName: p.billAttachmentName,
                          billAttachmentType: p.billAttachmentType,
                        })}
                        className="inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title={p.billAttachmentType === 'application/pdf' ? 'Open bill PDF' : 'Preview bill attachment'}
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        onClick={() => downloadBillAttachment({
                          billAttachmentUrl: p.billAttachmentUrl,
                          billAttachmentName: p.billAttachmentName,
                          billAttachmentType: p.billAttachmentType,
                        })}
                        className="inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="Download bill attachment"
                      >
                        <Download size={15} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="px-6 py-4 text-center">
                  <VerifyButton verified={!!p.verified} isAdmin={isAdmin} onVerify={() => handleVerify(p.id)} onUnverify={() => handleUnverify(p.id)} />
                </td>
                <td className="px-6 py-4">
                  <div className="flex justify-end gap-1">
                    {canEdit && (
                      <button
                        onClick={() => openEdit(p.id)}
                        className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={p.verified && !isAdmin ? 'Verified purchases can only be edited by admin' : 'Edit'}
                        disabled={p.verified && !isAdmin}
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => setDeleteConfirm(p)}
                        className="p-2 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={p.verified && !isAdmin ? 'Verified purchases can only be deleted by admin' : 'Delete'}
                        disabled={p.verified && !isAdmin}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <TablePagination {...purchasesPagination} onPageChange={purchasesPagination.setPage} />
      </div>

      <Modal isOpen={isModalOpen} onClose={closeModal} dirty={purchaseFormDirty} title={editingPurchaseId ? "Edit Purchase" : "Record New Purchase"} maxWidth="max-w-4xl"
        footer={(close) => <><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={handleSave} disabled={isSaving || lines.length === 0 || isPurchaseDetailLoading || insufficientPettyCash || !!billAttachmentError}>{editingPurchaseId ? 'Update Purchase' : 'Complete Purchase'}</Button></>}>
        <div className="space-y-6 py-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-transparent rounded-xl border border-border/50">
            <div>
              <Label>Vendor</Label>
              <Select value={formData.vendorId} onChange={(e:any) => setFormData({...formData, vendorId: Number(e.target.value)})}>
                <option value={0}>Select Vendor...</option>
                {vendors?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Purchase Date</Label>
              <Input type="date" max={new Date().toISOString().split('T')[0]} value={formData.purchaseDate} onChange={(e:any) => setFormData({...formData, purchaseDate: e.target.value})} />
            </div>
            <div>
              <Label>Invoice Number (Optional)</Label>
              <Input value={formData.invoiceNumber} onChange={(e:any) => setFormData({...formData, invoiceNumber: e.target.value})} placeholder="INV-12345" />
            </div>
          </div>

          <div className="p-4 bg-transparent rounded-xl border border-border/50 space-y-3">
            <div className="space-y-1">
              <Label>Upload Bill Copy (Optional)</Label>
              <p className="text-xs text-muted-foreground">Supported formats: JPG, JPEG, PNG, PDF</p>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
                  <Paperclip size={15} />
                  <span>{billAttachmentFile ? 'Replace file' : 'Choose file'}</span>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/jpg,image/png,application/pdf"
                    className="hidden"
                    onChange={(e:any) => handleBillAttachmentSelected(e.target.files?.[0] ?? null)}
                  />
                </label>
                {billAttachmentFile && (
                  <button
                    type="button"
                    onClick={clearSelectedBillAttachment}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X size={15} />
                    Remove selected file
                  </button>
                )}
              </div>

              {billAttachmentFile && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{billAttachmentFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(billAttachmentFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                  </div>
                </div>
              )}

              {!billAttachmentFile && existingBillAttachment?.billAttachmentUrl && !removeExistingBillAttachment && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{existingBillAttachment.billAttachmentName || 'Attached bill'}</p>
                    <p className="text-xs text-muted-foreground">{existingBillAttachment.billAttachmentType === 'application/pdf' ? 'PDF attachment' : 'Image attachment'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openBillAttachment(existingBillAttachment)}
                      className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Eye size={15} />
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoveExistingBillAttachment(true)}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                    >
                      <Trash2 size={15} />
                      Remove
                    </button>
                  </div>
                </div>
              )}

              {!billAttachmentFile && existingBillAttachment?.billAttachmentUrl && removeExistingBillAttachment && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span>Existing bill attachment will be removed when you save this purchase.</span>
                  <button
                    type="button"
                    onClick={() => setRemoveExistingBillAttachment(false)}
                    className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium"
                  >
                    Keep attachment
                  </button>
                </div>
              )}

              {!billAttachmentFile && !existingBillAttachment?.billAttachmentUrl && (
                <p className="text-sm text-muted-foreground">No bill copy selected.</p>
              )}

              {billAttachmentError && (
                <p className="text-sm text-destructive">{billAttachmentError}</p>
              )}
            </div>
          </div>

          <div className="p-4 bg-transparent rounded-xl border border-border/50 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={formData.isPaid}
                onChange={(e:any) => setFormData({...formData, isPaid: e.target.checked})}
                className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
              />
              <span className="text-sm font-medium text-foreground">Paid at the time of purchase</span>
              <span className="text-xs text-muted-foreground">(otherwise tracked as vendor payable)</span>
            </label>
            {formData.isPaid && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <Label>Payment Method</Label>
                  <Select value={formData.paymentMode} onChange={(e:any) => setFormData({...formData, paymentMode: e.target.value})}>
                    <option value="cash">Cash</option>
                    <option value="petty_cash">Petty Cash</option>
                    <option value="account">Bank / Account</option>
                    <option value="upi">UPI</option>
                  </Select>
                  {formData.paymentMode === 'petty_cash' && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        Available Petty Cash Balance: <span className="font-semibold text-foreground">{formatCurrency(availablePettyCashBalance)}</span>
                      </p>
                      {insufficientPettyCash && (
                        <p className="text-xs text-destructive">
                          Insufficient petty cash balance. Available: {formatCurrency(availablePettyCashBalance)}. Required: {formatCurrency(purchaseTotal)}.
                        </p>
                      )}
                    </div>
                  )}
                  {formData.paymentMode === 'petty_cash' && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      ⚠ The purchase total will be deducted from the petty cash balance.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between items-end mb-3">
              <h3 className="font-semibold text-foreground">
                Items Received <span className="text-muted-foreground font-normal">({lines.length})</span>
              </h3>
              <Button variant="outline" size="sm" onClick={addLine}><Plus size={14}/> Add Row</Button>
            </div>
            
            <div className="space-y-2">
              <div className="flex gap-3 px-3 py-2 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide tracking-wider">
                <div className="flex-1">Ingredient</div>
                <div className="w-20 text-right">Qty</div>
                <div className="w-28 text-right">Rate ($)</div>
                <div className="w-20 text-right">Tax (%)</div>
                <div className="w-36">Expiry</div>
                <div className="w-28 text-right">Total</div>
                <div className="w-10"></div>
              </div>
              {editingPurchaseId && isPurchaseDetailLoading && (
                <div className="px-3 py-4 text-sm text-muted-foreground">Loading purchase details...</div>
              )}
              {lines.map((line, idx) => {
                const lineTotal = (line.quantity * line.unitRate) * (1 + line.taxPercent/100);
                return (
                  <div key={idx} className="flex items-center gap-3">
                    <div className="flex-1">
                      <Select value={line.ingredientId} onChange={(e:any) => updateLine(idx, 'ingredientId', Number(e.target.value))}>
                        <option value={0}>Select...</option>
                        {ingredients?.map(ing => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                      </Select>
                    </div>
                    <div className="w-20">
                      <Input type="number" value={line.quantity} onChange={(e:any) => updateLine(idx, 'quantity', Number(e.target.value))} className="text-right" />
                    </div>
                    <div className="w-28">
                      <Input type="number" step="0.01" value={line.unitRate} onChange={(e:any) => updateLine(idx, 'unitRate', Number(e.target.value))} className="text-right" />
                    </div>
                    <div className="w-20">
                      <Input type="number" value={line.taxPercent} onChange={(e:any) => updateLine(idx, 'taxPercent', Number(e.target.value))} className="text-right" />
                    </div>
                    <div className="w-36">
                      <Input
                        type="date"
                        min={new Date().toISOString().split('T')[0]}
                        value={line.expiryDate || ''}
                        onChange={(e:any) => updateLine(idx, 'expiryDate', e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="w-28 text-right font-medium px-2 py-2 bg-muted/50 rounded-xl border border-transparent">
                      {formatCurrency(lineTotal)}
                    </div>
                    <button onClick={() => removeLine(idx)} className="p-2 text-muted-foreground hover:text-destructive transition-colors w-10 flex justify-center">
                      <Trash2 size={18} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-border">
            <div className="text-right">
              <p className="text-sm text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Grand Total</p>
              <p className="text-3xl font-display font-bold text-primary">{formatCurrency(purchaseTotal)}</p>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Purchase"
        footer={(close) => <><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></>}
      >
        <p className="py-2 text-sm text-muted-foreground">
          Delete purchase <span className="font-semibold text-foreground">{deleteConfirm?.purchaseNumber}</span>? This removes its line items too.
        </p>
      </Modal>

      <Modal
        isOpen={!!previewAttachment}
        onClose={closePreviewAttachment}
        title={previewAttachment?.billAttachmentName || 'Bill Attachment'}
        maxWidth="max-w-3xl"
        footer={(close) => <><Button variant="ghost" onClick={() => { closePreviewAttachment(); close(); }}>Close</Button></>}
      >
        {previewAttachment?.objectUrl ? (
          <div className="space-y-3 py-2">
            <img
              src={previewAttachment.objectUrl}
              alt={previewAttachment.billAttachmentName || 'Bill attachment'}
              className="max-h-[70vh] w-full rounded-xl border border-border object-contain"
            />
            <div className="flex justify-end">
              <a
                href={previewAttachment.objectUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Eye size={15} />
                Open in new tab
              </a>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
