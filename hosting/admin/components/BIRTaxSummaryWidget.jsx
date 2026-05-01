import React, { useMemo } from "react";

const PHP = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

export default function BIRTaxSummaryWidget({
  transactions = [],
  expenses = [],
  isVatRegistered = false,
  percentageTaxRate = 0.03,
  vatRate = 0.12,
}) {
  const summary = useMemo(() => {
    const completedSales = transactions.filter((t) => t.status === "COMPLETED");
    const totalGrossSales = completedSales.reduce((sum, t) => sum + Number(t.grossAmount || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const netTaxableIncome = totalGrossSales - totalExpenses;

    const estimatedTax = isVatRegistered
      ? totalGrossSales * vatRate
      : totalGrossSales * percentageTaxRate;

    const missingReceipts = expenses.filter((e) => !String(e.receiptPhotoUrl || "").trim()).length;

    return { totalGrossSales, totalExpenses, netTaxableIncome, estimatedTax, missingReceipts };
  }, [transactions, expenses, isVatRegistered, percentageTaxRate, vatRate]);

  return (
    <section className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 800 }}>BIR Tax Summary Widget</h3>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Metric label="Total Gross Sales" value={PHP.format(summary.totalGrossSales)} />
        <Metric label="Total Expenses" value={PHP.format(summary.totalExpenses)} />
        <Metric label="Net Taxable Income" value={PHP.format(summary.netTaxableIncome)} />
        <Metric
          label={isVatRegistered ? "Estimated VAT (12%)" : "Estimated Percentage Tax (3%)"}
          value={PHP.format(summary.estimatedTax)}
        />
      </div>
      {summary.missingReceipts > 0 && (
        <p style={{ marginTop: 12, color: "#b45309", fontWeight: 600 }}>
          ⚠️ {summary.missingReceipts} expense record(s) are missing receipt photos.
        </p>
      )}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
      <div style={{ color: "#64748b", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
