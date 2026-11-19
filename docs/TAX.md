# Tax configuration

## VAT

- Registration threshold: **R2.3m** (R2,300,000) rolling 12 months.
- Default measure: **agent revenue** — platform fees, commission and handling.
  Gross marketplace sales are shown for information only.
- The system never auto-registers for VAT. The operator obtains a VAT number,
  enters the registration date and changes `vat_registered` deliberately.
- While unregistered, no VAT is charged on any invoice.
- The agent/principal rules are in `docs/tax/accountant-report.md`.

## Micro-business turnover tax

- This is an annual income-tax regime, not a transaction tax.
- It is never added to a buyer, seller or commission invoice.
- Zoho accounts: `Turnover Tax Expense` and `Turnover Tax Payable`.
- The annual amount is supplied by the accountant; the system records the
  provision and payment journals.
- The system only monitors turnover against the configured limit and does not
  decide eligibility or calculate the liability.

## Source of truth

The accountant-facing PDF is generated from
`docs/tax/accountant-report.md` with:

```bash
cd backend
node scripts/accountant-tax-report.mjs
```

Output: `docs/tax/ALL-Outdoor-Tax-and-Accounting-Report.pdf`.

The report must be reviewed by the accountant before any VAT activation or
income-tax submission.
