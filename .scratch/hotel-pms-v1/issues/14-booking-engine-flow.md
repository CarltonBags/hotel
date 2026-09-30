# Booking engine flow

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 02 04

## Question

Define the public booking engine: search by dates and occupancy across room types (single property, and whether a tenant-level multi-property search exists), rate plan display, extras, guest details, payment or guarantee at booking, confirmation. Decide embedding model (hosted page per property vs widget), what data it needs from the rates model, and how bookings flow into the PMS. Must satisfy the payments provider constraints.

## Answer

Resolved 2026-09-28 by grilling.

**Delivery**
- A hosted booking page per property, reachable under the hotel's own domain (for example `book.hotel-name.de`), carrying the hotel's logo, photo and tenant accent colour.
- A copy-paste search widget for the hotel's website (dates, guests, button) that opens the hosted flow. The flow itself, and payment in particular, never runs inside an iframe.
- A simple tenant page for chains: pick dates and guests, see every property with its lowest available price, choose a hotel, continue in that property's flow. One booking belongs to one property; no multi-property cart.

**Flow**: search, rooms with rates, extras, details, payment, confirmation. The stay summary stays visible throughout.
- Search: dates, adults, child ages, optional code.
- Rooms with rates: each available room type with photos and, underneath, its rate plans. Availability respects restrictions and Out of Order blocks.
- Extras: Services flagged bookable online, as one optional step.
- Details: required are first name, last name, email, phone, country. Optional are arrival time, special requests, "booking for someone else" (separates Booker from Primary Guest) and "I need a company invoice" (company name, address, VAT ID). Full address and passport data come later in Pre-check-in.
- Payment, then confirmation page and email with the Portal Link.

**Prices**: the total for the stay including VAT is the headline price, with the per-night average shown small. City Tax is listed as its own line and included in the total; when an exemption depends on the guest, the engine assumes the tax applies and the hotel corrects it at check-in. Prices are always in the property currency.

**Guarantee at booking** comes from the rate plan's **Payment Policy**, one of: pay in full now, pay a deposit now (percentage or first night), card guarantee only, or no card. The policy is shown in plain words before payment. The first card authorisation always runs strong customer authentication and stores the card for later merchant-initiated charges, with consent text naming what may be charged.
- Money taken at booking is a Payment on the folio and triggers the automatic Deposit Invoice, as decided in the folio ticket.
- A **Card Guarantee** stores the card without charging it; no-show and late-cancellation fees are charged against it.

**Last room**: an **Inventory Hold** reserves the chosen rooms for 10 minutes once the guest proceeds to details and payment; a countdown appears only near the end. Abandoned holds are released. Holds reduce availability for every channel.

**Several rooms**: the guest adds rooms one by one, each with its own room type, rate plan and guests, and pays once. Result: one Booking with several Reservations. Property limit, default 5; above it the engine asks the guest to contact the hotel.

**Codes**: a **Rate Code** reveals rate plans that are not public. A corporate code can also attach a Company as Booker or Bill-to. No coupon arithmetic.

**Self-service after booking**, through the Portal Link: cancel (instant and refunded inside the free window; fee shown and confirmed outside it), change dates (re-priced at current rates, difference paid or refunded, only where the rate plan allows), add extras until arrival.

**Languages**: interface shipped in German, English, French, Italian, Spanish, Dutch and Polish at launch. The property enables the languages it offers and writes its own texts per enabled language.

**Into the PMS**: a completed checkout creates a Booking with Source "Booking Engine" and Confirmed Reservations, appears in the staff app in real time, and queues the availability change for the channel manager.

**Required from the rates model** (passed to "Rates and restrictions model"): per rate plan a Payment Policy, a Cancellation Policy (free until when, fee after), whether date changes are allowed, public or hidden behind a Rate Code, bookable online or not, included Services, and texts per language.

> Update 2026-09-29 from "Search visibility of hosted booking pages": a search engine's price checker clicks through the flow as far as it can without typing guest data. The Inventory Hold must therefore start only after the guest has entered something, not on opening the details step, or checker visits would hold rooms. To be settled in "Search visibility decisions".

> Update 2026-09-29 from "Tourism statistics reporting duties": every guest, including companions and German nationals, needs a **country of residence** as its own field beside nationality, and residents of Austria and Germany a postal code. Registration forms cannot supply this, since they skip German nationals and count companions only. The "country" asked at checkout is the country of residence.

> Update 2026-09-29, owner's clarification: our booking page is **optional per property**. A hotel may keep the booking tool its website already has and connect it; see "Connecting a hotel's existing website booking tool". We run no website of our own on which guests find hotels.

> **Superseded 2026-09-29.** The owner ruled that the product has no booking page: guests book through the hotel's own website tool, booking sites through the channel manager, or staff. Everything above about our booking page, chain page, website widget, Inventory Hold, online Rate Codes and online self-service date change and cancellation no longer applies. Still valid and used elsewhere: Payment Policy and Cancellation Policy on rate plans, the guest data asked at booking (now asked by staff or received from channels), and City Tax shown as its own line.
