# BayanGo

## Compliance Architecture

### BIR-Ready Accounting Engine

- **Invoice Serialization:** Use sequential invoice numbers (example: `2026-0001`, `2026-0002`) for legal traceability and audit readiness.
- **Immutable Sales Records:** Transactions marked as `COMPLETED` must be locked from edit/delete actions.
- **Receipt-Backed Expenses:** Every expense should include a supplier invoice number and receipt photo upload URL.
- **Tax Logic:**
  - Default to **3% Percentage Tax** for non-VAT entities.
  - Use **12% VAT computation** once VAT registration/threshold applies.
- **Retention Rule:** Keep accounting records and backups for at least **5 years**.

### Cloud Function Export

Use `exportMonthlyAccountingCsv` (HTTP GET) with `month=YYYY-MM`.

Example:

```bash
curl "https://<region>-<project>.cloudfunctions.net/exportMonthlyAccountingCsv?month=2026-05"
```

CSV columns: `Date | Invoice/OR # | Description | Category | Amount`.

### Dashboard Tax Summary Widget

Use `hosting/admin/components/BIRTaxSummaryWidget.jsx` in admin dashboard to show:

- Total Gross Sales
- Total Expenses
- Net Taxable Income
- Estimated 3% Percentage Tax (or 12% VAT if VAT-registered)
- Missing receipt warning count for audit follow-up
