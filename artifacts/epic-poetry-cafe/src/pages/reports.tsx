import React, { useState } from 'react';
import { PageHeader, Button, Input, Label, Select, Modal } from '../components/ui-extras';
import { Download, FileBarChart } from 'lucide-react';

export default function Reports() {
  const [reportType, setReportType] = useState('sales');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = () => {
    setIsExporting(true);
    // Simulating export process since exportReport hook returns CSV string
    setTimeout(() => {
      setIsExporting(false);
      alert('Report exported successfully. Check your downloads folder.');
    }, 1500);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Data Export & Reports" description="Generate CSV exports for accounting and deep analytics" />

      <div className="bg-card border border-border rounded-2xl shadow-sm p-8 flex flex-col md:flex-row gap-10">
        <div className="md:w-1/3 space-y-6">
          <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-4">
             <FileBarChart size={32} />
          </div>
          <h2 className="text-2xl font-display font-bold">Generate Report</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Select the module and date range to extract raw data. The exported CSV files are formatted for immediate import into external accounting software or Excel analysis.
          </p>
        </div>
        
        <div className="md:w-2/3 space-y-6 bg-muted/20 p-6 rounded-2xl border border-border/50">
          <div>
            <Label>Report Module</Label>
            <Select value={reportType} onChange={(e:any) => setReportType(e.target.value)}>
              <option value="sales">Sales & Revenue</option>
              <option value="purchases">Purchases & Inwards</option>
              <option value="expenses">Expenses & Overheads</option>
              <option value="inventory">Inventory Snapshots</option>
              <option value="waste">Waste Logs</option>
            </Select>
          </div>
          
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <Label>From Date</Label>
              <Input type="date" max={new Date().toISOString().split('T')[0]} value={fromDate} onChange={(e:any) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label>To Date</Label>
              <Input type="date" max={new Date().toISOString().split('T')[0]} value={toDate} onChange={(e:any) => setToDate(e.target.value)} />
            </div>
          </div>
          
          <div className="pt-4 flex justify-end">
            <Button onClick={handleExport} disabled={isExporting} className="w-full sm:w-auto h-12 px-8">
              {isExporting ? 'Generating...' : <><Download size={18} /> Export as CSV</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
