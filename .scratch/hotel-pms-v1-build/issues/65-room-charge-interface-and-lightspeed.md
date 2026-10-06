# 65 — Room charge interface for external tills and the Lightspeed connection

**What to build:** A hotel that keeps its own till connects it through our published room charge interface (guest lookup returning only Checked-in guests not blocked with remaining Spending Limit; post charge, idempotent, with items, tax per line, tip apart, the till's receipt number and fiscal id; reverse charge linked to the original) or through Lightspeed Restaurant's room charge contract with nothing installed at the hotel. Charges land as one Charge per Tax Code per bill with items; totals-only postings are accepted. Charges for checked-out guests are rejected; failed postings not retried by the till are listed for staff to reconcile. The interface is documented for till vendors.

**Blocked by:** 26 Check-in with folio posting, Charges and Routing Rules, 61 Outlet payments: room charge, readers, tap to pay, cash, vouchers, tips, discounts, voids

**Status:** in review (PR stacked on ticket 64)

- [ ] Lightspeed sandbox posts a bill that appears on the folio with items and tip (built and walked through with simulated Lightspeed requests; the sandbox needs partner approval, see Open points)
- [x] Duplicate posting with the same id is ignored
- [x] Reversal appears as negative Charge linked to the original
- [x] Interface documentation published with examples

## Comments

**Built:** External Tills under Settings → External tills (Property Manager): our room charge interface or Lightspeed Restaurant, a key per till shown once and kept as a hash (new key on demand), revenue and tip accounts, and the Tax Code per till rate where a rate fits more than one. Our interface (`/api/till/v1`): guest lookup (Checked-in, not blocked, covered, with limit left; tips outside the limit), post a bill (items, or totals per rate without items; receipt number and fiscal id kept), take a whole bill back (a Correction of each of its Charges, ADR 0015). The Lightspeed contract (`/api/lightspeed/search` and `/charge`): its account read as our bill (tax multiplier, tip on the payment, `IKPMS` only, whole bill only), a void as the Correction of the first account. On the folio: one Charge per Tax Code with items as detail, the tip on its own 0 % line on the tip account. The same posting twice is taken once; a stay's postings are serialised, so two bills never both pass the limit. Refusals (checked-out guest, blocked, over the limit, unknown rate, …) are kept with what the till sent and listed under Till postings until staff reconcile them; a reconciled bill sent again is refused. Documented with examples in `docs/room-charge-interface.md`. Glossary: External Till, Till Posting.

**Verified:** domain `till.test.ts` (groups per rate, totals only, Tax Code choice, Lightspeed translation); db `tills.test.ts` (lookup, posting with items and tip apart, idempotency, tip outside the limit, Correction once, negative bill refused, refusals listed and reconciled, a reconciled bill not posted again); full db suite 357 passed; walkthrough 12/12 in the browser (connecting two tills in the settings, lookup, wrong key, posting and repeat, Charges per Tax Code with the tip apart, Correction naming the originals, Lightspeed search and charge with items and tip, the folio, checked-out refusal, listed and reconciled).

**Review fixes:** a bill taken back is a Correction (same Service Date and Tax Code, naming the original; refused when invoiced or already taken back) instead of new negative Charges; negative bills refused; tips flagged and kept out of the Spending Limit; the stay locked while a posting is checked; a reconciled refusal is never posted on a resend; a guest with nothing left of the limit is not offered; the Lightspeed charge checks the venue when named and accepts a payment with or without the tip; request bodies capped before reading; Lightspeed requests (key in the query) kept out of the request log; refusal codes from the domain instead of matching texts; glossary wording (Correction, not reversal).

**Open points:**
- Lightspeed: partner approval is needed for the sandbox. Five points of their contract need confirming there (see the documentation).
- The hosting access logs must drop the query string of `/api/lightspeed/`.
- The 0 % Tax Code for tips and the default tip account 1590 go to the tax advisor with the other till questions.
- Partial room charges (part of a bill to the room) are refused until a rule for splitting over Tax Codes is decided.
