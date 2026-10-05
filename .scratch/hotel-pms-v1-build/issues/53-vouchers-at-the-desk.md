# 53 — Vouchers at the desk

**What to build:** Front Desk sells a value Voucher by any tender, delivered by email with a code (copy to the buyer), and redeems it as a Tender on a folio at any property of the Legal Entity that sold it, partially with a remaining balance; sale is a liability, not revenue, and redemption is signed under German rules like cash. Vouchers in circulation are listed with balances.

**Blocked by:** 50 Cash desk: Cash Registers, Shifts, Cash Book, Paid-outs and Receipts, 51 Fiscal module Germany through fiskaly

**Status:** in review (PR stacked on ticket 52)

- [x] Partial redemption leaves the right balance and a second redemption uses it
- [x] Redemption at a property of another Legal Entity is refused
- [x] Voucher sale appears in the liability account on the cash reports
- [x] Redemption receipt is signed in Germany

## Comments

**Built.** The Vouchers page (Property Manager and Front Desk, matrix "Sell and redeem Vouchers at the desk"): sell a value Voucher for cash (into the open Shift's Cash Book), card on the terminal or bank transfer (with the slip's or transfer's reference); booked to the Legal Entity's Voucher liability account (Settings → Legal Entities; required before the first sale), never revenue. The sale gets a Receipt, signed in Germany as a multi-purpose voucher bought (no VAT, DSFinV-K MehrzweckgutscheinKauf) and in Austria; the code (XXXX-XXXX-XXXX, unmistakable characters) goes by email to the recipient with a copy to the buyer, except in Test Mode. Redeemed as the Tender "Voucher" on a folio with its code, at any property of the selling Legal Entity in its currency, partly with the rest left on it; locked against double spending; a refund of a redemption gives the value back; another company's property refuses it. The redemption gets a Receipt signed like cash; before check-in it gets a Deposit Invoice like any money received. Vouchers in circulation listed with balances, a code lookup. The cash report shows the sales by every tender on the liability account and what the company still owes on its Vouchers; the exit export has vouchers.csv with balances.

**Verified.** domain: codes and balances. db: 4 tests (sale with Cash Book, liability, signed Receipt, mails; partial and second redemption, refusal above the balance, refund back onto the Voucher; refusal at another Legal Entity; list, card and transfer sales on the report, sold Vouchers immutable). Walkthrough 10/10: no sale without the account, sale for cash with Cash Book and mails, the sale's signed Receipt, redemption of 30 and 70 on folios with signed Receipts, list and lookup balance, refusal at the Austrian property.

**Review fixes.** Redemption only for the desk roles (not Accounting); currency checked; the list filters open Vouchers before its limit; card and transfer sales and the outstanding balance on the cash report; vouchers.csv and the Receipt's Voucher in the exit export; DSFinV-K text for a Voucher sold; the public Receipt names the buyer by initial and surname; no mail in Test Mode; signing by the Receipt's id; the payments panel clears the code when the tender changes.

**Open points.**
- A card sale is recorded with the terminal slip's reference, not taken through the integrated reader (no folio to attach it to); reconciling it is the accounting export's job (ticket 56).
- A Voucher sold by mistake cannot be undone yet (it would need a cancellation receipt and the money back).
- Tax advisor: Vouchers are treated as multi-purpose (VAT on redemption); redemptions are DSFinV-K "Umsatz"/"Anzahlungseinstellung" with payment type "Unbar" rather than a separate MehrzweckgutscheinEinloesung case.
- The code stays in the outbox's mail text after sending.
