# ALL Outdoor — Tax and Accounting Wiring Report

**Prepared for:** ALL Outdoor (Pty) Ltd — external accountant / tax adviser  
**Prepared by:** ALL Outdoor engineering  
**Report date:** 19 November 2026  
**Status:** For review and sign-off — not a tax return and not tax advice  
**Implementation status:** Agent invoice wording, tax profile, threshold reporting and the principal motivation paygate are implemented. Seller-payout and refund cash entries are proposed and still require implementation before the books are complete. VAT is not active.

## 1. Purpose

This report explains how the ALL Outdoor marketplace, payment rails and Zoho Books
are wired — and, where marked, how they still need to be wired — so the accountant
can approve the treatment or request changes. It covers the agent/principal
classification, VAT threshold, micro-business turnover tax, chart of accounts, and
the transaction flow from a buyer payment to a seller payout.

## 2. Executive summary

- Every **Buy Now** and **Auction** sale is an **AGENT supply**. ALL Outdoor collects
  the item price and delivery on behalf of the seller and courier. Those amounts are
  a liability (Client Funds Payable), not ALL Outdoor revenue or VAT turnover.
- ALL Outdoor's own marketplace supplies are the **platform fee, commission and
  delivery handling margin**.
- Every Zoho document line states its capacity on its face: `*` marks an
  **agent collection** (money ALL Outdoor collects for the seller or courier)
  and `**` marks a **principal supply** (ALL Outdoor's own fee). The document
  notes carry the legend, so the split is readable without the chart of
  accounts.
- **Motivation** is the only **PRINCIPAL** product. Its paygate went live on
  20 November 2026 at **R295 per motivation**: the full price is ALL Outdoor
  revenue, invoiced to the member and posted to **Motivation Revenue**.
- The **VAT registration threshold is R2.3m** (R2,300,000 / 230,000,000 cents).
  ALL Outdoor is **not VAT-registered** at the date of this report.
- The business is configured for **micro-business turnover tax**. This is an annual
  income-tax regime; it is never added to a customer invoice.
- Zoho Books is the accounting system. The organization should be South Africa /
  ZAR with the tax year supplied by the accountant.

## 3. Agent versus principal

| Product | Supply role | Revenue recognised by ALL Outdoor |
|---|---|---|
| Buy Now (marketplace) | Agent | Platform fee, commission, handling margin |
| Auction | Agent | Buyer fee + seller commission, handling margin |
| Motivation (paygated, R295) | Principal | Full R295 — ALL Outdoor's own service |
| Seller/courier item and freight | Principal (seller/courier) | None — collected as agent |
| Seller failure recovery | Separate recovery document | Cost recovery, not platform fee |

Consequences:

1. The buyer invoice names item and delivery as **agent collections**, never
   "principal supplies".
2. Item and delivery post to **Client Funds Payable**, not revenue.
3. On VAT registration, item and delivery must not carry ALL Outdoor output VAT.
4. A tax invoice for the item remains the seller's responsibility; ALL Outdoor's
   invoice covers its agent supply.

The capacity is marked on every document line:

| Marker | Meaning | Lines |
|---|---|---|
| `*` | Agent collection — collected for a third party, posted to Client Funds Payable, never revenue | Item, Delivery |
| `**` | Principal supply — ALL Outdoor's own supply, posted to revenue | Platform Fee / commission |

Both markers are explained in the notes block of every buyer invoice, seller
invoice and credit note.

## 4. Zoho Books organisation and accounts

The setup check must confirm:

| Item | Required state |
|---|---|
| Country | South Africa |
| Currency | ZAR |
| Financial/tax year end | Supplied by the accountant |
| VAT number | Empty while not registered |
| Income-tax number | Business income-tax number |
| VAT rate | 15% only when VAT is activated |

Required accounts:

| Account | Use |
|---|---|
| Client Funds Payable (Trust) | Buyer money held for sellers/couriers |
| Bob Go Prepaid Balance | Courier float funded from the ABSA business bank |
| Courier Freight Expense | Bob Go freight consumed from the float |
| Platform Fee Revenue | ALL Outdoor agent fee |
| Motivation Revenue | Principal income from paid motivations (R295 each) |
| Commission Revenue | Auction seller commission (may be same account) |
| Shipping Handling Revenue | Delivery handling margin |
| Courier / Delivery Costs | Carrier freight expense |
| VAT Output | VAT on agent supplies, once registered |
| VAT Input | VAT on business purchases, once registered |
| Turnover Tax Expense | Annual micro-business tax provision |
| Turnover Tax Payable | Liability until paid |

## 5. Money flow maps

### 5.1 Buyer pays a Buy Now or Auction sale

| Step | Debit | Credit | Notes |
|---|---|---|---|
| Buyer pays | Bank | Buyer / Accounts Receivable | Full buyer total received |
| Buyer invoice | Accounts Receivable | Client Funds Payable (item + delivery) | `*` Agent collection |
| Buyer invoice | Accounts Receivable | Platform Fee Revenue | `**` Principal supply (ALL Outdoor's own fee) |
| Handling margin journal | Client Funds Payable | Shipping Handling Revenue | Delivery margin only |
| Carrier freight journal | Client Funds Payable | Bank | Courier freight paid |
| Seller payout | Client Funds Payable | Bank | Net amount sent to seller |
| Commission invoice | Seller / Accounts Receivable | Commission Revenue | `**` Principal supply (ALL Outdoor's own fee) |
| Commission settlement | Client Funds Payable | Seller / Accounts Receivable | Clears commission from held money |

The seller payout journal is a required part of the books; without it Client Funds
Payable remains overstated and the bank balance includes money already paid out.
**Current status:** this journal is not yet posted by the integration; it is
proposed here for approval and implementation.

### 5.2 Refund to buyer

| Step | Debit | Credit | Notes |
|---|---|---|---|
| Credit note | Platform Fee Revenue / Client Funds Payable | Buyer / Accounts Receivable | Reverses the original supply split — implemented |
| Refund cash out | Buyer / Accounts Receivable | Bank | Actual refund paid — not yet posted by the integration |

The credit note alone does not move cash. The refund payment is required before the
books can be treated as complete.

### 5.3 Seller failure recovery

| Step | Debit | Credit | Notes |
|---|---|---|---|
| Seller charge invoice | Seller / Accounts Receivable | Recovery Revenue | Seller-facing document |
| Recovery from payout | Client Funds Payable | Seller / Accounts Receivable | Invoice paid from withheld payout |
| Provision (if applicable) | Recovery Expense | Recovery Payable | Accountant decision |

### 5.4 Member pays for a motivation (principal)

Live since 20 November 2026. The member builds the application free and pays
**R295** when they press "Write my motivation"; nothing is generated before Ozow
confirms the capture.

| Step | Debit | Credit | Notes |
|---|---|---|---|
| Member pays via Ozow | ABSA Current Account | Member / Accounts Receivable | Cash received — implemented |
| Motivation invoice | Member / Accounts Receivable | Motivation Revenue | Principal supply, one line `Motivation MO000123` — implemented |
| Payment recorded against the invoice | Member / Accounts Receivable | — | Settles the invoice from the bank — implemented |

The invoice carries **no VAT line** (not VAT-registered) and its notes state, in
words, that it is a principal supply and not an agent collection. One payment per
application; a failed generation is re-run free, so a refund is only ever needed
if the document cannot be delivered at all.

## 6. Bob Go prepaid float

Bob Go is a prepaid courier wallet. ALL Outdoor funds the wallet from its ABSA
business bank account; Bob Go then deducts each shipment. The bank therefore only
shows the top-ups, not the individual carrier charges.

| Step | Debit | Credit | Notes |
|---|---|---|---|
| Fund Bob Go | Bob Go Prepaid Balance | ABSA Current Account | Bank transfer to the Bob Go wallet |
| Shipment consumes float | Client Funds Payable | Bob Go Prepaid Balance | Buyer-paid freight cleared to the asset |
| Self-funded shipping | Courier Freight Expense | Bob Go Prepaid Balance | No bank movement at shipment time |
| Re-weigh/surcharge | Courier Freight Expense | Bob Go Prepaid Balance | Recovered from seller where applicable |
| Monthly Bob Go invoice | Courier Freight Expense + VAT Input | Accounts Payable — Bob Go | Bill from the Bob Go tax invoice |
| Apply prepaid to bill | Accounts Payable — Bob Go | Bob Go Prepaid Balance | Clears the bill against the float |

Bob Go's shipping API does not expose a wallet statement endpoint. The monthly
Bob Go invoice/statement must be imported manually as a vendor bill, and the wallet
balance reconciled to the Bob Go Prepaid Balance account. A shipment-derived
reconciliation is a secondary check only; it cannot prove top-ups, fees, VAT or
adjustments.

No historical shipping reclassification is required: no shipment has yet moved
between actual clients. The prepaid entries begin with the first live shipment.

## 7. VAT threshold: R2.3m

- The registration threshold is **R2,300,000**, measured over a rolling 12 months.
- The default measurement basis is **agent revenue** (platform fees, commission and
  handling), because the marketplace is an agent.
- Gross marketplace sales are shown for information only, not as the VAT threshold.
- The monitor raises alerts at 80%, 90% and 100% of the threshold.
- It **does not auto-register** the business for VAT. The operator obtains the VAT
  number and changes the setting deliberately.
- If the accountant determines that gross sales are the correct measure, the basis
  is configurable, but that must be an explicit signed decision.

## 8. Micro-business turnover tax

- The regime is **turnover tax** for a qualifying micro business.
- It is an **annual income-tax regime**, not a transaction tax.
- No turnover-tax line appears on any buyer, seller or commission invoice.
- The Zoho accounts are:
  - **Turnover Tax Expense**;
  - **Turnover Tax Payable**.
- The accountant supplies the annual amount. The system records:
  - provision: **Dr Turnover Tax Expense / Cr Turnover Tax Payable**;
  - payment: **Dr Turnover Tax Payable / Cr Bank**.
- The system reports turnover against the configured limit but does not decide
  eligibility and does not calculate the tax.

## 9. Open decisions for the accountant

Please approve or amend each item:

1. Is the **agent** treatment correct for every Buy Now and Auction sale?
2. Are item and delivery correctly treated as **out of scope** for ALL Outdoor VAT,
   with the seller/courier responsible for their own supplies?
3. Is the VAT threshold measured on **agent revenue**, or must gross marketplace
   sales be used?
4. What is the company's **tax year end** and Zoho financial year end?
5. Is the business eligible for **micro-business turnover tax** at its current
   turnover? If not, which regime applies?
6. Is the seller-failure recovery standard-rated, zero-rated or out of scope?
7. Should seller commission invoices carry the seller's VAT number where the seller
   is a VAT vendor?
8. Are the Zoho chart-of-accounts names and mappings acceptable, or should accounts
   be renamed/reclassified?
9. Is a separate seller tax invoice for the item required, or is the agent
   collection disclosure on the buyer invoice sufficient?
10. Any additional records required for SARS record-keeping?

## 10. Sign-off

| Decision | Accountant initials | Date | Notes |
|---|---|---|---|
| Approve as documented |  |  |  |
| Approve with changes |  |  |  |
| Reject / rework |  |  |  |

**Accountant name:** ______________________________  
**Practice / firm:** ______________________________  
**Signature:** ______________________________  
**Date:** ______________________________

## 11. Vendor / system note

This report is generated from the ALL Outdoor accounting configuration. It does not
contain bank account numbers, access tokens or buyer/seller personal information.
Configuration values and the Zoho setup check should be re-run before relying on the
figures in a VAT or income-tax submission.

**Current implementation gaps:** seller-payout and buyer-refund cash entries are
not yet posted to Zoho; gateway fees are not yet journaled. These are shown in the
flow tables as proposed entries. The accountant's approval of those flows is needed
before implementation is completed.
