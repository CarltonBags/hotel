# Accounting export (DATEV) mapping

Map: ../map.md
Type: grilling
Status: open
Blocked by: 31

## Question

Define the accounting export built on the folio model: which events become booking lines (invoice issued, cancellation invoice, deposit invoice, payment, refund, receivable settled), how Services map to revenue accounts and Tax Codes to DATEV tax keys, the chart of accounts default (SKR03 vs SKR04) and per-Legal-Entity overrides, debtor accounts for Companies vs a collective account for guests, how payments by tender map to clearing accounts (Stripe payout reconciliation, OTA collect), export period and lock (Festschreibung) and its link to Night Audit, and what Austria and Switzerland need instead. Verify the file format against the official DATEV specification with a pilot customer's tax advisor.

Added by "Cash handling and fiscal cash-register obligations": the export also covers cash accounts per Cash Register, cash differences, Paid-outs with expense accounts, bank deposits, tips paid out, and the voucher liability account (sale, redemption, expiry).

## Comments

2026-09-28: grilled with the product owner. The owner chose to keep this ticket unresolved until "Tax advisor confirmation of fiscal and voucher rules" is answered. The decisions below are a **draft**, agreed in substance, not yet final.

**Draft decisions**
- **Basis**: invoices. Each Invoice, Deposit Invoice and Cancellation Invoice becomes booking lines, one per revenue account and tax rate, against the debtor. Charges of in-house guests enter the books only when invoiced.
- **Detail**: one line per invoice per revenue account and tax rate, invoice number in the document field. Payments are one line each.
- **Debtors**: each on-account Company gets its own debtor account, numbered automatically from a range and editable. All guests who pay at checkout share one collective debtor account.
- **Accounts**: the Legal Entity picks one of two shipped templates for the German standard charts. Every Service, Tax Code, Tender, Cash Register, cash difference, voucher liability and City Tax has an account in a mapping table that Accounting can edit. Templates are labelled as needing the advisor's confirmation. The export refuses to run while any used item has no account.
- **Payments**: booked per Tender to a clearing account: card online and terminal to a card-provider clearing account, bank transfer to a bank clearing account, cash to the Cash Register's account, voucher to the voucher liability, OTA collect to a receivable from that OTA. Card provider payouts and fees are not booked; a payout report is offered as a separate download.
- **Liabilities**: money received before the stay is a liability until the final invoice nets the Deposit Invoice. A Voucher sale is a liability until redeemed.
- **Cash desk**: cash differences, Paid-outs with their expense accounts, bank deposits, transfers between registers and tips paid out are exported from the Cash Book.
- **Period**: any range of closed Business Dates. Preview can be repeated. Finalising marks the period as exported and sets the lock flag; the same file can be downloaded again unchanged. Later corrections appear in the next period as new documents.
- **Documents**: a package with every invoice and the photos of Paid-out receipts, file names matching the document field.
- **Formats in v1**: the German advisor booking-batch format and a documented neutral CSV with the same content. Native Austrian and Swiss formats are fog.

**Waiting on the tax advisor**: account numbers and tax keys in both templates; treatment of City Tax (pass-through or revenue); deposit handling on cancellation; voucher expiry; tips; field lengths and encoding against the official format specification.

> Note 2026-09-29 from "Austrian and Swiss accounting formats": the draft above models a line as gross amount plus tax key. Other target formats need net, tax and gross per line. The internal export model should carry all three from the start, whatever the German file shows.
