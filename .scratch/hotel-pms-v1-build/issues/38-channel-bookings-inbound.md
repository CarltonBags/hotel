# 38 — Channel bookings inbound and per-channel settings

**What to build:** New, modified and cancelled bookings from booking sites and the hotel's own website booking tool arrive through the Channex webhook, are acknowledged, then applied idempotently by booking revision: Booking with Source Channel carrying the channel name, Reservations with stored prices, guest data, notes, OTA collect or virtual card tender information ("virtual card at booking site" with activation date where known; card tokens only where delivered). Per-channel settings: whether prices include VAT and City Tax (City Tax split backwards per the rule), our own confirmation on or off, Tender "paid via website tool" for money taken by the tool. Google can be switched on as a channel with its plain-language explanation. Channel bookings never oversell; conflicts are listed for staff.

**Blocked by:** 37 Channex connection and ARI outbox, 30 City Tax Rule and filing report

**Status:** in review (PR stacked on ticket 37)

- [x] Replaying the same revision changes nothing; a newer revision updates the reservation
- [x] A channel price including City Tax is split so the guest pays exactly the channel price
- [x] Cancellation from the channel cancels the reservation and frees availability
- [x] Website tool booking appears with its Source name and its payment recorded

> Added 2026-10-05 from ticket 89: from day 60 of subscription non-payment, inbound channel and booking-page reservations are refused (`acceptsOnlineReservations` in the domain); existing stays continue.

## Comments

**Built**
- **Intake:** the channel manager's webhook (our secret in a header; the Channex property id finds the tenant) triggers a pull of that property's feed of unacknowledged revisions.
  - A five-minute pull catches lost webhooks.
  - Properties connected before this ticket get their webhook registered by the job.
  - Each revision is applied, then acknowledged. A revision that fails, or that Channex sent unreadable, is recorded for staff and acknowledged, so it never holds back the rest.
- **Applying a revision:**
  - **Idempotent:** a replay changes nothing and an older revision is ignored.
  - **Updates:** a newer revision updates dates, room type, rate plan, occupancy, guest and prices. Room assignments follow (released on a type change, trimmed on a shorter stay), and the change is logged like staff's. Rooms are added or cancelled as needed.
- **New bookings:**
  - a Booking with Source Channel, the channel's name and its booking number and remarks (kept apart from staff's notes);
  - who collects (hotel or booking site);
  - the booking site's virtual card with activation, expiry and amount;
  - a card tokenised by the channel manager (token and last digits only, never a card number);
  - the guest, reusing a profile with the same email and last name, plus a profile per named room guest;
  - Reservations with the channel's nightly prices made ours.
- **Prices:**
  - What the channel says its prices contain wins over the property's setting for that channel.
  - The City Tax comes off first, computed on the room's net price without included Services. VAT is then added for net channels, at the room's rate; Services keep their own price.
  - The guest pays exactly the channel price.
  - Children sent without an age count as adults, so they are taxable for City Tax.
  - Prices in another currency are refused.
- **Cancellations:** from the channel, without a fee of ours; the rooms are freed. Stays already in house, or rooms cancelled here but still booked at the channel, are listed instead.
- **Never refused for lack of rooms:** the booking is kept, flagged overbooked and listed.
  - Unknown rate plans and, from day 60 of non-payment, new bookings are refused and listed.
  - The desk is notified with a link to the reservation, and marks problems seen to.
- **Per-channel settings:**
  - prices with VAT and City Tax or not;
  - our own confirmation on or off (used by the guest messages);
  - money taken by the website tool, recorded as a Payment (new tender "website tool", the whole channel price) with its Deposit Invoice. More after a change is recorded; less is listed for refund through the tool.
- **Google's free booking links:** a switch with its plain-language explanation; our support is asked to switch it at the channel manager.
- **Reservation page:** shows the channel, who collects, the virtual card, the stored card and the channel's remarks.
- **Staging script:** also takes Channex's test bookings from the feed.

**Verified**
- Parser: rooms with nightly prices, guest, who collects, virtual card; children without age; tax flags; card token without the number.
- Domain:
  - City Tax split backwards (Berlin percentage, Hamburg step);
  - breakfast left out of the City Tax base;
  - a net price with City Tax.
- DB tests:
  - new booking with channel, guest, notes, collect, virtual card; replay;
  - stale and newer revisions;
  - City Tax split to the exact channel price;
  - cancellation without fee frees the room;
  - website tool payment; overbooking kept and listed;
  - unknown plan and non-payment refusals;
  - shorter stay trims the room assignment and logs the change;
  - other currency refused; tool money with City Tax and a refund listed;
  - unreadable revision listed and acknowledged; the feed oldest first, each acknowledged.
- Worker: webhook needs our secret and routes to the tenant; a refused booking notifies the desk.
- All packages typecheck and pass.
- Walkthrough (12/12):
  - a channel setting saved;
  - a booking arrives with Source Channel, name, guest and collect, City Tax split out;
  - replay changes nothing;
  - the reservation shows channel, collect and virtual card;
  - a cancellation from the channel;
  - an unknown plan refused and listed;
  - Google switched on with support asked;
  - webhook refused without the secret, taken with it.

**Review fixes**
- **Blocked feed:** one failing revision blocked the property's feed; it is now recorded and acknowledged. Unreadable revisions are listed and acknowledged instead of being redelivered forever.
- **Shorter stays:** kept their room on nights no longer booked. Assignments now follow the stay, and the change is logged.
- **Notes:** a modification overwrote staff's notes; the channel's remarks now have their own field.
- **Tax order:** City Tax was computed with Services in its base and before VAT on net prices. Now: City Tax first, on the room's net price; then VAT; Services at their own rates.
- **Website tool money:** the payment missed the City Tax; it is now the whole channel price. Changes adjust it, or list a refund.
- **Currency:** a booking in another currency was taken as the property's; it is now refused.
- **Children without an age:** were given age 8; they now count as adults (taxable).
- **Guests:** were never deduplicated, and room guests were ignored. Profiles are now reused by email and last name, and named room guests get their own.
- **Webhooks:** the test webhook secret is refused in production. Webhook ids no longer collapse two changes of one booking. Earlier connections get their webhook.
- **Access:** the desk can open the problems list it is notified about. Revenue no longer sees a "Seen to" it cannot use. Support cannot change channel settings or Google.
- **Spec gaps:** card token, virtual card expiry and the channel's own tax flags are now handled.

**Open points**
- **Field names:** Channex field names for taxes, virtual card dates and the Stripe Tokenization App token follow the public docs, unverified. Confirm on staging with the owner's key, together with the booking test cases.
- **City Tax caps:** the split is per night. Per-stay caps (e.g. Berlin's 21 nights) and exemptions recorded later are applied when the stay is charged, so on long stays the guest may pay slightly differently from the channel price.
- **Virtual cards:** the card is shown on the booking, not yet a Card Guarantee of its own kind. Charging it stays with the desk's "OTA virtual card" tender. A stored channel card token is charged with ticket 41.
- **Google:** switched on at Channex by our support (not through the API). The ticket 47 decisions (Channex's booking page for Google) still apply.
- **Spec wording:** "acknowledged, then applied" is done as "applied, then acknowledged", as the research recommends: nothing is acknowledged that is not stored.
