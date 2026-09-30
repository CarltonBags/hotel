# Booking engine look prototype

Map: ../map.md
Type: prototype
Status: resolved
Blocked by: 15

## Question

What does the hosted booking page look like on phone and desktop? Prototype the decided flow (search, rooms with rates, extras, details, payment, confirmation) in the guest-facing visual language chosen for self check-in (cinematic, photo-led) adapted to a page that must convert and rank: the room list with several rate plans per room type and their policies in plain words, the persistent stay summary, the multi-room cart, the Inventory Hold countdown, the Rate Code entry, the tenant page across properties, and the search widget as it appears inside a hotel's own website. Decide how much of the hotel's branding (logo, photo, accent, font) the page takes.

Added by "Cash handling and fiscal cash-register obligations": value vouchers are sold online on the hosted booking page (amount, recipient, message, card payment, delivery by email). Include the voucher purchase page in the prototype.

## Answer

Resolved 2026-09-29 by prototype; verdict given by the product owner in the browser.

**Look: variant A, "Cinematic".** Photo hero with the hotel's headline and a glass search bar, large photo cards per room type, the cart as a floating bar at the bottom. Same visual family as Self Check-in. Variants B (light with side summary) and C (split with photo panel) were not chosen.

**Dark or light**: the hotel chooses one for its page, set once per property. Same layout in both. It does not follow the visitor's device setting.

**Branding the page takes from the hotel**: logo and name; photos (hero and a gallery per room type); accent colour, contrast checked automatically; font, picked from a short list of pairings. Free choice of any font is not offered.

**Room list**
- One card per room type: photo, name, size, beds, occupancy, key Room Features, availability note ("Only 2 left", "Sold out for these dates").
- Up to three rate plans shown per room type; "more rates" unfolds the rest. The hotel sets the order. The cheapest flexible and the cheapest non-refundable plan are always among the first three. Plans unlocked by a Rate Code come first and are marked.
- Each rate plan shows: name, cancellation in plain words, payment in plain words, total for the stay including VAT, price per night small, "Add room".
- Tapping photo or name opens a detail sheet: gallery, full description, all Room Features, floor plan if provided. Closing returns to the same place.

**Cart and summary**: the floating bar shows room count and total. Tapping it opens the summary sheet: rooms with rate plans, extras, City Tax, total, amount due now and at the hotel, remove room. From the details step on, desktop shows the summary permanently beside the form.

**Steps after the room list**, as prototyped: extras as selectable cards; details with the two optional sections; payment with each room's policy in plain words, the amount charged now, the consent text, and the button naming the amount ("Pay 420.55 and book" or "Book with card guarantee"); confirmation with "Open my booking" and "Add to calendar".

**Inventory Hold**: a quiet line while more than two minutes remain; a visible countdown in the last two minutes; when it runs out, a notice with "check availability again" and the booking button disabled.

**Other pages, accepted as prototyped, in the chosen look**
- Chain page: hotels as photo cards with lowest price for the dates; hotels without rooms are greyed.
- Widget for the hotel's own website: dates, guests, button; opens the hosted page; takes only the accent colour.
- Voucher page: amount chips and free amount, recipient, message, card payment, note that redemption is at the reception.

**Known flaws of the prototype, not decisions**: on the phone frame the cart bar of look A floats below the frame; photos are colour gradients; the search fields are not interactive; look A was only built dark.

Assets:
- Screenshots: `docs/design/booking-engine/` (winner files marked WINNER).
- Prototype: `apps/staff-shell-prototype`, route `/prototype/booking?variant=A|B|C`, params `device=phone`, `demo=<step>`, `page=tenant|widget|voucher`, `code=SIEMENS26`, `accent=<hex>`. Code in `components/prototype/booking/`. Uncommitted.

> **Superseded 2026-09-29.** The owner ruled that the product has no booking page: guests book through the hotel's own website tool, booking sites through the channel manager, or staff. This prototype is kept as record only. Its cinematic look remains the look of the Guest Portal and Self Check-in.
