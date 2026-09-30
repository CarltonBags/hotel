# 38 — Channel bookings inbound and per-channel settings

**What to build:** New, modified and cancelled bookings from booking sites and the hotel's own website booking tool arrive through the Channex webhook, are acknowledged, then applied idempotently by booking revision: Booking with Source Channel carrying the channel name, Reservations with stored prices, guest data, notes, OTA collect or virtual card tender information ("virtual card at booking site" with activation date where known; card tokens only where delivered). Per-channel settings: whether prices include VAT and City Tax (City Tax split backwards per the rule), our own confirmation on or off, Tender "paid via website tool" for money taken by the tool. Google can be switched on as a channel with its plain-language explanation. Channel bookings never oversell; conflicts are listed for staff.

**Blocked by:** 37 Channex connection and ARI outbox, 30 City Tax Rule and filing report

**Status:** ready-for-agent

- [ ] Replaying the same revision changes nothing; a newer revision updates the reservation
- [ ] A channel price including City Tax is split so the guest pays exactly the channel price
- [ ] Cancellation from the channel cancels the reservation and frees availability
- [ ] Website tool booking appears with its Source name and its payment recorded
