# Restaurant and bar charges to the room

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 42

## Question

With the point-of-sale research in hand, decide: which systems v1 connects to and how; the guest lookup the waiter sees and the limits (room charge allowed per reservation, spending limit); how charges appear on the folio (one line per bill or per item, Tax Codes, tip); corrections and reversals; what happens for checked-out guests and for Bill-to company; and who signs the sale fiscally.

From the research: the folio model has no posting target for non-guests (events, walk-in company accounts); the first automatic connection does not resend failed postings, so they are reconciled by hand; a partial room charge needs a rule for splitting over Tax Codes; a property running its bar on an external till has no Cash Register for it in the product. Five questions for the tax advisor are listed in the findings.

> Note 2026-09-29: the owner wants an own point of sale for bar, restaurant and spa. Whether the connection to external tills stays in v1 is decided in "Own point of sale for bar, restaurant and spa"; this ticket waits for it.

> Update 2026-09-30 from "Own point of sale for bar, restaurant and spa": external tills stay in v1 through our published room charge interface, Lightspeed first. This ticket now covers only that interface; our own point of sale is decided there.

## Answer

Resolved 2026-09-30 by grilling. Scope: external tills of hotels that do not use our own point of sale.

**Connections in v1**
- Lightspeed Restaurant through its public room charge contract, nothing needed at the hotel.
- Our own published room charge interface (guest lookup, post charge, reverse charge) for any till vendor that implements it.
- **FIAS-based tills** (Oracle Simphony, Vectron and others that expect a local interface server), reached through the **Lock Bridge** already on site (owner's choice beyond the recommendation). The Bridge gains a till plugin that speaks FIAS locally and relays outbound; it is renamed in the glossary to **Site Bridge**, since it now carries locks and tills. Hotels without an on-site lock system get the Bridge for their till alone.

**On the folio**: one Charge per Tax Code per bill, for example "Restaurant bill 4711, 19 %" and "7 %", with the items stored as detail and viewable. Tip as its own line. The till's receipt number and fiscal identifier are kept. The external till stays the fiscal cash register for the sale; we sign only when the folio is paid at the desk.

**Rules**: the same as for our own point of sale. Lookup returns only guests who are Checked-in, not blocked for room charge, with remaining Spending Limit. Over the limit the till takes payment. Charges for checked-out guests are rejected; staff post by hand if needed. Postings that fail and are not retried by the till are listed for staff to reconcile.

**Totals without items** (FIAS delivers only totals per tax rate): accepted; the folio shows totals per Tax Code without item detail.
