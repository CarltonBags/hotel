# 60 — Outlets, menus, table service, printers and Outlet Sale

**What to build:** A property defines Outlets (bar, restaurant, spa, other) with menus from the Service catalogue, kitchen and bar printers, a Cash Register and a table plan; roles Service, Spa Staff and Outlet Manager with PIN Sign-in on enrolled phones and tablets (a fixed till is a tablet). Service opens a bill per table or guest, adds items with modifiers, sends order rounds to the printers, splits and moves bills; Outlet Manager edits menus, prices and printers of own outlets. Walk-in customers are served as an Outlet Sale paid on the spot with a Receipt, optional customer name, or invoiced on account for a Company event. Payments beyond cash come in ticket 61.

**Blocked by:** 14 Devices and PIN Sign-in, 16 Service catalogue and Tax Codes, 50 Cash desk: Cash Registers, Shifts, Cash Book, Paid-outs and Receipts

**Status:** in review (PR stacked on ticket 59)

- [x] Order round prints on the right printer with table and modifiers
- [x] Split bill by items and move bill between tables keep totals
- [x] Outlet Manager of the bar cannot edit the restaurant menu
- [x] Outlet Sale with cash closes through the outlet's Shift and Receipt

## Comments

**Built.** Settings → Outlets (Property Manager, Point of Sale Module): outlets of kind bar, restaurant, spa or other, each with its Cash Register, in use or not, and its Outlet Managers. The outlet's menu (Services of the catalogue at the outlet's price, with category, printer and modifiers such as "no ice" or "double +4"), its kitchen and bar printers (an ePOS network address, or empty to show tickets on screen) and its table plan are kept by the Property Manager or the outlet's own Outlet Manager. The outlet app (/outlet) works on enrolled phones and tablets with PIN Sign-in (Service, Spa Staff land there after the PIN) and with a password: tables with their open bills and totals; a bill per table or for a guest without one; items with modifiers and notes; the order round sends every item not sent yet and makes one print job per printer with table, bill, round, waiter, items, modifiers and notes, printed by the outlet's device (Epson ePOS, ten-second timeout, five tries, then listed to print by hand); an item not sent yet can be taken back; split by items (some, never all) and move between tables. The Outlet Sale is paid in cash through the user's Shift on the outlet's Cash Register (outlet staff open and close it on the cash page) with a Receipt listing outlet, bill, items and the optional customer name, signed by the TSE like any payment; or invoiced on account to a Company (a Receivable). The bill's items become Charges on a folio of the bill, so outlet revenue counts by Service Date; an outlet invoice is cancelled like any other.

**Verified.** domain: 7 tests (pricing with modifiers, tickets per printer, ticket text, ePOS request, splits, own-outlet rights). db: 5 tests (the bar's Outlet Manager refused on the restaurant, Service refused on setup; a round printed on bar and kitchen printers with table, modifiers and note, taken jobs not handed out twice, a failed one retried; split and move keep totals, never a split of all items; cash sale refused without a Shift and on the desk register, then through the bar's Shift with Receipt, Cash Book and Charges; Company event invoiced on account, refused for Spa Staff, cancelled by a Cancellation Invoice). Walkthrough 8/8 in the staff app: outlet with register, printers, tables and menu set up in the UI; round printed on screen per printer with table and modifiers; split and move; Shift on the bar's register; cash sale with a TSE-signed Receipt listing items and customer.

**Review fixes.** One place decides a folio's owner (reservation, group, outlet bill) for invoices, deposits and cancellations (an outlet invoice could not be cancelled); a split never empties a bill; printing with a timeout, lost answers tolerated, jobs re-taken only after two minutes; Spa Staff do not invoice Company events; an Outlet Manager sees the Cash Books of own outlets' registers and reaches the setup from the outlet app; outlet staff open, count and close Shifts only (not every desk cash action); a closed outlet takes no new orders; failed tickets listed to print by hand; the Receipt renders outlet items instead of hiding the stay line. Also fixed: the WhatsApp db test depended on the hour it ran at (desk-closed answer and send times); it now runs on a fixed clock.

**Open points.**
- Printing from the HTTPS staff app to a printer on the local network: browsers block plain http:// (mixed content, Private Network Access); printers need an https:// ePOS address or a print bridge (Site Bridge, ticket 68). Not tried on real printers.
- PIN Sign-in for Outlet Managers: ticket 60 says yes, the decision ("Own point of sale") says Service and Spa Staff only; left with password sign-in. Owner to decide.
- Spa Staff only take money for now; spa sales come with ticket 63. Card, voucher, Room Charge, tips, discounts, voids and outlet reports come with ticket 61; signing each order round (Germany) with ticket 62.
- Outlet Managers are chosen among holders of the role in the UI; the db does not check the role itself (rights need it anyway).
- Outlet Charges are routed as "extras" (they sit on the bill's own folio; revenue reports read Service and account).
- Not asked for: a bill closes only when its printer items are sent; on-account invoicing needs the Company to be on account.
