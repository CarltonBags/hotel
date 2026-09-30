# 62 — Outlet fiscal signing and offline selling

**What to build:** German outlets sign every order round as an order within 45 seconds of each change and the bill with its payment when the bill is created, sharing a table key and printing the first order's time; cancellations become new negative signed records; Austrian outlets sign only the payment (card counts as cash). Offline: the device keeps menus and open bills; orders, bills and cash payments continue; receipts are marked as issued during an outage per country and signed and sent afterwards; Room Charge offline only for guests on the last synced in-house list within the limit and verified after reconnection; card payments offline only on readers with chip and PIN, flagged for the hotel's risk and not refundable before forwarding.

**Blocked by:** 61 Outlet payments: room charge, readers, tap to pay, cash, vouchers, tips, discounts, voids, 51 Fiscal module Germany through fiskaly, 52 Fiscal module Austria through fiskaly

**Status:** ready-for-agent

- [ ] Order round signed within 45 seconds in the fiskaly test environment; bill references the table key
- [ ] Airplane mode: two orders and a cash payment complete, then sign and sync after reconnect in order
- [ ] Offline Room Charge for a guest not on the synced list is refused
- [ ] Offline reader payment forwarded later appears on the connected account
