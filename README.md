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


## Firebase Hosting Troubleshooting

### `HTTP Error: 404 ... /sites/bayango-user-demo/versions`

If deploy fails with:

`Request to https://firebasehosting.googleapis.com/v1beta1/projects/-/sites/bayango-user-demo/versions had HTTP Error: 404, Requested entity was not found.`

it usually means the **Hosting site does not exist in the currently selected Firebase project**, or your CLI is pointing to the wrong project.

Run these checks in order:

```bash
firebase use
firebase target
firebase hosting:sites:list --project bayango-315c6
```

If `bayango-user-demo` is missing, create it and re-apply the deploy target:

```bash
firebase hosting:sites:create bayango-user-demo --project bayango-315c6
firebase target:apply hosting user-demo bayango-user-demo --project bayango-315c6
```

Then deploy again:

```bash
firebase deploy --only hosting:user-demo --project bayango-315c6
```

If you intentionally use a different project, update `.firebaserc` target mapping for `user-demo` to a site that exists in that project.

### `Failed to make request ... /.settings/rules.json?dryRun=true`

If Realtime Database rules deploy fails with:

`Failed to make request to https://bayango-315c6-default-rtdb.asia-southeast1.firebasedatabase.app/.settings/rules.json?dryRun=true`

the issue is usually one of these:

1. **Wrong Firebase project selected in CLI** (most common).
2. **Realtime Database instance is missing/renamed** in that project.
3. **Your account lacks Realtime Database Admin permission** for that project.

Run these checks:

```bash
firebase use
firebase projects:list
firebase database:instances:list --project bayango-315c6
```

Expected instance name for this repo is typically `bayango-315c6-default-rtdb` in region `asia-southeast1`.

Then verify auth and deploy rules explicitly to the correct project:

```bash
firebase login
firebase deploy --only database --project bayango-315c6 --debug
```

If the instance list does not include `bayango-315c6-default-rtdb`, either:

- create a Realtime Database instance in `asia-southeast1`, or
- update all `databaseURL` values in the repo to match the actual instance URL before deploying.
