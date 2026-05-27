import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSalesInvoices } from "../src/lib/salesInvoiceSummaryMath.js";
test("summarizeSalesInvoices matches a single invoice final/gross/gst totals", () => {
    const summary = summarizeSalesInvoices([
        { grossAmount: 1000, totalDiscount: 0, gstAmount: 50, finalAmount: 1050, matchStatus: "matched" },
    ]);
    assert.deepEqual(summary, {
        count: 1,
        gross: 1000,
        discount: 0,
        gst: 50,
        final: 1050,
        mismatched: 0,
    });
});
test("summarizeSalesInvoices matches multiple invoices including discounts and GST", () => {
    const summary = summarizeSalesInvoices([
        { grossAmount: 2000, totalDiscount: 200, gstAmount: 90, finalAmount: 1890, matchStatus: "matched" },
        { grossAmount: 1000, totalDiscount: 0, gstAmount: 50, finalAmount: 1050, matchStatus: "matched" },
        { grossAmount: 500, totalDiscount: 25, gstAmount: 23.75, finalAmount: 498.75, matchStatus: "mismatched" },
    ]);
    assert.deepEqual(summary, {
        count: 3,
        gross: 3500,
        discount: 225,
        gst: 163.75,
        final: 3438.75,
        mismatched: 1,
    });
});
test("summarizeSalesInvoices does not double subtract discounts from final totals", () => {
    const summary = summarizeSalesInvoices([
        { grossAmount: 3000, totalDiscount: 500, gstAmount: 0, finalAmount: 2500, matchStatus: "matched" },
        { grossAmount: 500, totalDiscount: 0, gstAmount: 0, finalAmount: 500, matchStatus: "matched" },
    ]);
    assert.equal(summary.gross, 3500);
    assert.equal(summary.discount, 500);
    assert.equal(summary.final, 3000);
});
test("summarizeSalesInvoices ignores verification state and mixed invoice types because totals are invoice-final based", () => {
    const summary = summarizeSalesInvoices([
        { grossAmount: 750, totalDiscount: 50, gstAmount: 35, finalAmount: 735, matchStatus: "matched" },
        { grossAmount: 1250, totalDiscount: 0, gstAmount: 62.5, finalAmount: 1312.5, matchStatus: "matched" },
    ]);
    assert.equal(summary.final, 2047.5);
    assert.equal(summary.gross, 2000);
    assert.equal(summary.gst, 97.5);
});
