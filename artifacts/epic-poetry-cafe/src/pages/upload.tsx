import React, { useState, useRef } from 'react';
import { PageHeader, Button, formatCurrency } from '../components/ui-extras';
import { Upload, Download, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';

type UploadType = 'sales-invoices' | 'purchases' | 'expenses' | 'menu' | 'petpooja';

interface UploadResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  results: { row: number; status: string; error?: string; data?: any }[];
  autoCreated?: string[];
}

const UPLOAD_CONFIGS: Record<UploadType, { label: string; description: string; columns: string[] }> = {
  'sales-invoices': {
    label: 'Sales Invoices',
    description: 'Upload invoices with multiple line items and GST. Rows with the same Invoice_No are grouped into one invoice.',
    columns: ['Date', 'Invoice_No', 'Time', 'Order_Type', 'Customer', 'Item (name)', 'Quantity', 'GST_Percent', 'Discount', 'Payment_Mode', 'GST_Inclusive'],
  },
  purchases: {
    label: 'Purchases',
    description: 'Upload purchase lines with vendor, ingredient, quantity, and rate. Lines with same vendor + date + invoice are grouped into one purchase.',
    columns: ['Date', 'Vendor (name)', 'Ingredient (name)', 'Quantity', 'UOM', 'Rate', 'Tax_Percent', 'Invoice', 'Payment_Mode'],
  },
  expenses: {
    label: 'Expenses',
    description: 'Upload expense entries with cost type, category, amount, and payment details',
    columns: ['Date', 'Cost_Type (fixed/variable/semi_variable)', 'Category', 'Description', 'Amount', 'Tax', 'Payment_Mode', 'Paid_By'],
  },
  menu: {
    label: 'Menu & Recipes',
    description: 'Upload menu items with recipe lines. Rows with the same item name are grouped — first row sets item details, all rows add recipe lines.',
    columns: ['Menu_Item', 'Category', 'Description', 'Selling_Price', 'Dine_In_Price', 'Takeaway_Price', 'Delivery_Price', 'Ingredient', 'Quantity', 'UOM', 'Wastage_Percent', 'Stage', 'Notes'],
  },
  petpooja: {
    label: 'Petpooja Import',
    description: 'Import Petpooja sales data. Items are matched by name — new items and categories are auto-created with price if they don\'t exist.',
    columns: ['Date', 'Order_ID', 'Time', 'Order_Type', 'Customer', 'Item (name)', 'Category', 'Price', 'Quantity', 'GST_Percent', 'Discount', 'Payment_Mode'],
  },
};

export default function UploadPage() {
  const [activeType, setActiveType] = useState<UploadType>('sales-invoices');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const config = UPLOAD_CONFIGS[activeType];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const token = localStorage.getItem('token');
      const baseUrl = import.meta.env.BASE_URL || '/';
      const apiBase = `${window.location.origin}${baseUrl}api`.replace(/\/+/g, '/').replace(':/', '://');

      const uploadPath = `upload/${activeType}`;
      const resp = await fetch(`${apiBase}/${uploadPath}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Upload failed' }));
        setResult({ totalRows: 0, successCount: 0, errorCount: 1, results: [{ row: 0, status: 'error', error: err.error || 'Upload failed' }] });
        return;
      }

      const data: UploadResult = await resp.json();
      setResult(data);
    } catch (e: any) {
      setResult({ totalRows: 0, successCount: 0, errorCount: 1, results: [{ row: 0, status: 'error', error: e.message || 'Network error' }] });
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = () => {
    const token = localStorage.getItem('token');
    const baseUrl = import.meta.env.BASE_URL || '/';
    const apiBase = `${window.location.origin}${baseUrl}api`.replace(/\/+/g, '/').replace(':/', '://');
    const url = `${apiBase}/upload/template/${activeType}`;

    const a = document.createElement('a');
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (!r.ok) throw new Error('Failed to download template');
        return r.blob();
      })
      .then(blob => {
        a.href = URL.createObjectURL(blob);
        a.download = `${activeType}_template.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(e => {
        console.error('Template download failed:', e);
        alert('Failed to download template. Please try again.');
      });
  };

  const handleReset = () => {
    setSelectedFile(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleTypeChange = (type: UploadType) => {
    setActiveType(type);
    handleReset();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Excel Upload" description="Import invoices, purchases, expenses, or menu items from Excel files">
        <Button onClick={handleDownloadTemplate} className="bg-secondary text-secondary-foreground hover:bg-secondary/80">
          <Download size={18} /> Download Template
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(Object.entries(UPLOAD_CONFIGS) as [UploadType, typeof config][]).map(([type, cfg]) => (
          <button
            key={type}
            onClick={() => handleTypeChange(type)}
            className={`p-5 rounded-2xl border text-left transition-all duration-200 ${
              activeType === type
                ? 'border-primary bg-primary/5 shadow-md ring-2 ring-primary/20'
                : 'border-border/50 bg-card hover:border-border hover:shadow-sm'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <FileSpreadsheet size={20} className={activeType === type ? 'text-primary' : 'text-muted-foreground'} />
              <span className="font-semibold text-sm">{cfg.label}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{cfg.description}</p>
          </button>
        ))}
      </div>

      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h3 className="font-semibold mb-3 text-sm">Expected Columns for {config.label}</h3>
        <div className="flex flex-wrap gap-2 mb-6">
          {config.columns.map(col => (
            <span key={col} className="px-3 py-1.5 bg-muted rounded-lg text-xs font-medium text-muted-foreground">{col}</span>
          ))}
        </div>

        <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
          {selectedFile ? (
            <div className="space-y-3">
              <FileSpreadsheet size={40} className="mx-auto text-green-500" />
              <p className="font-medium">{selectedFile.name}</p>
              <p className="text-sm text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p>
              <div className="flex gap-3 justify-center">
                <Button onClick={handleUpload} disabled={uploading}>
                  {uploading ? <><Loader2 size={18} className="animate-spin" /> Uploading...</> : <><Upload size={18} /> Import Data</>}
                </Button>
                <Button onClick={handleReset} className="bg-secondary text-secondary-foreground hover:bg-secondary/80">
                  Clear
                </Button>
              </div>
            </div>
          ) : (
            <label className="cursor-pointer space-y-3 block">
              <Upload size={40} className="mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">Click to select an Excel file (.xlsx, .xls)</p>
              <p className="text-xs text-muted-foreground/60">Maximum file size: 5 MB</p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>

      {result && (
        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="p-6 border-b border-border/50">
            <h3 className="font-semibold mb-4">Import Results</h3>
            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
              <div className="bg-muted/50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold">{result.totalRows}</p>
                <p className="text-xs text-muted-foreground mt-1">Total Rows</p>
              </div>
              <div className="bg-green-50 dark:bg-green-950/20 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{result.successCount}</p>
                <p className="text-xs text-green-600/70 mt-1">Imported</p>
              </div>
              <div className={`rounded-xl p-4 text-center ${result.errorCount > 0 ? 'bg-red-50 dark:bg-red-950/20' : 'bg-muted/50'}`}>
                <p className={`text-2xl font-bold ${result.errorCount > 0 ? 'text-red-600' : ''}`}>{result.errorCount}</p>
                <p className={`text-xs mt-1 ${result.errorCount > 0 ? 'text-red-600/70' : 'text-muted-foreground'}`}>Errors</p>
              </div>
            </div>
          </div>

          {result.autoCreated && result.autoCreated.length > 0 && (
            <div className="px-6 py-4 border-b border-border/50 bg-blue-50/50 dark:bg-blue-950/10">
              <h4 className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1.5">
                <AlertCircle size={14} /> Auto-Created Items
              </h4>
              <div className="flex flex-wrap gap-2">
                {result.autoCreated.map((item, idx) => (
                  <span key={idx} className="px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-xs text-blue-700 dark:text-blue-300">{item}</span>
                ))}
              </div>
            </div>
          )}

          {result.results.length > 0 && (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="px-6 py-3 text-left">Row</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {result.results.map((r, idx) => (
                    <tr key={idx} className={r.status === 'error' ? 'bg-red-50/50 dark:bg-red-950/10' : ''}>
                      <td className="px-6 py-3 text-muted-foreground">{r.row}</td>
                      <td className="px-6 py-3">
                        {r.status === 'success' ? (
                          <span className="inline-flex items-center gap-1.5 text-green-600"><CheckCircle2 size={14} /> Success</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-red-600"><XCircle size={14} /> Error</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-xs">
                        {r.error ? (
                          <span className="text-red-600">{r.error}</span>
                        ) : r.data ? (
                          <span className="text-muted-foreground">{JSON.stringify(r.data)}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
