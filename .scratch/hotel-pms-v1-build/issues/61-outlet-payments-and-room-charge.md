# 61 — Outlet payments: room charge, readers, tap to pay, cash, vouchers, tips, discounts, voids

**What to build:** Service or Spa Staff close a bill by Room Charge (allowed only when the reservation is Checked-in, not blocked for room charge, and covered by a Card Hold, Card Guarantee or on-account Bill-to within the property's Spending Limit per night; above the limit the guest pays or an Outlet Manager approves; the staff member sees room, surname, yes/no and remaining limit, never card data; the guest signs on the device or receipt; one Charge per Tax Code per bill with items as detail lands on the folio by Routing Rules), by card on a paired reader (girocard needs a reader) or tap to pay on the phone (not girocard), by cash through the outlet's Shift, by Voucher, with tips on the reader or inside the phone amount. Discounts up to the outlet's percentage, more with Approval; voids of a signed order and refunds need Outlet Manager or Approval. Outlet reports per outlet, day and user. Front Desk and Accounting see outlet Room Charges on folios and may move or void an uninvoiced one with reason.

**Blocked by:** 60 Outlets, menus, table service, printers and Outlet Sale, 27 Payments: Stripe onboarding, Card Holds, Tenders and refunds, 53 Vouchers at the desk, 31 Approvals, role limits, Price Override and the audit log screen

**Status:** ready-for-agent

- [ ] Room Charge refused for a checked-out guest and for one over the Spending Limit without Approval
- [ ] Bill with 7 % and 19 % items becomes two Charges with item detail on the folio
- [ ] Tap to pay on a test phone completes for Visa; girocard routed to the reader
- [ ] Discount above the outlet percentage needs Approval; void of a signed order by Service is refused
