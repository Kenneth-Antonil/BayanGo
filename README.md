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

## Android Native App (Kotlin)
A new improved-native Android scaffold is available at `android-user-native/`.
See `ANDROID_NATIVE_PLAN.md` for migration scope and milestones.

## Android Native Quick Start
1. Open `android-user-native/` in Android Studio.
2. Set Gradle JDK to **17**.
3. Run `app` on emulator/device.
4. Demo login accepts any valid email + password (6+ chars).

5. To connect real backend next, implement a new `UserRepository` (e.g. FirebaseUserRepository) and inject it into `UserViewModel`.


## Firebase Integration (Auth + Firestore)
- `FirebaseUserRepository` is implemented in `android-user-native` and ready to use.
- Add your `google-services.json` to `android-user-native/app/`.
- Set `USE_FIREBASE_REPOSITORY` to `true` in `app/build.gradle.kts` after wiring your Firebase project.
- Default collection names expected:
  - `merchants` (`name`, `etaMinutes`, `tags`)
  - `orders` (`userEmail`, `status`, `detail`)
  - `users` (`email`, `name`, `address`, `payment`)


### Live Firebase Checklist
- Replace `android-user-native/app/google-services.json` placeholder values with your actual Firebase config file.
- `USE_FIREBASE_REPOSITORY` is now set to `true` by default in `android-user-native/app/build.gradle.kts`.
- Firestore collections must exist with these fields:
  - `merchants`: `name` (string), `etaMinutes` (number), `tags` (array of strings)
  - `orders`: `userEmail` (string), `status` (string), `detail` (string)
  - `users`: `email` (string), `name` (string), `address` (string), `payment` (string)
