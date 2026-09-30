# 65 — Room charge interface for external tills and the Lightspeed connection

**What to build:** A hotel that keeps its own till connects it through our published room charge interface (guest lookup returning only Checked-in guests not blocked with remaining Spending Limit; post charge, idempotent, with items, tax per line, tip apart, the till's receipt number and fiscal id; reverse charge linked to the original) or through Lightspeed Restaurant's room charge contract with nothing installed at the hotel. Charges land as one Charge per Tax Code per bill with items; totals-only postings are accepted. Charges for checked-out guests are rejected; failed postings not retried by the till are listed for staff to reconcile. The interface is documented for till vendors.

**Blocked by:** 26 Check-in with folio posting, Charges and Routing Rules, 61 Outlet payments: room charge, readers, tap to pay, cash, vouchers, tips, discounts, voids

**Status:** ready-for-agent

- [ ] Lightspeed sandbox posts a bill that appears on the folio with items and tip
- [ ] Duplicate posting with the same id is ignored
- [ ] Reversal appears as negative Charge linked to the original
- [ ] Interface documentation published with examples
