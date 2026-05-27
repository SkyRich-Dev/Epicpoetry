export type SalesInvoiceSummary = {
  count: number;
  gross: number;
  discount: number;
  gst: number;
  final: number;
  mismatched: number;
};

export function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function summarizeSalesInvoices(invoices: Array<{
  grossAmount: number;
  totalDiscount: number;
  gstAmount: number;
  finalAmount: number;
  matchStatus: string;
}>): SalesInvoiceSummary {
  return invoices.reduce<SalesInvoiceSummary>((acc, inv) => ({
    count: acc.count + 1,
    gross: round2(acc.gross + Number(inv.grossAmount || 0)),
    discount: round2(acc.discount + Number(inv.totalDiscount || 0)),
    gst: round2(acc.gst + Number(inv.gstAmount || 0)),
    final: round2(acc.final + Number(inv.finalAmount || 0)),
    mismatched: acc.mismatched + (inv.matchStatus === "mismatched" ? 1 : 0),
  }), { count: 0, gross: 0, discount: 0, gst: 0, final: 0, mismatched: 0 });
}
