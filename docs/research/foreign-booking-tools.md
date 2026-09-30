# Foreign website booking tools: how they deliver reservations

Resolves ticket `.scratch/hotel-pms-v1/issues/56-foreign-booking-tools-research.md`.
Researched 2026-09-29 against vendor documentation, live interface descriptions and vendor product pages. Anything not backed by a primary source is marked **UNVERIFIED**.

Background not repeated here: `channel-manager-selection.md` (chosen channel manager: Channex.io, its interface model, limits and certification).

**Method and limits.** Every detail below (field names, endpoint names, prices) was read from the raw text of the cited page, fetched directly; no summarising tool was used. Web search was not available during this research, so vendor pages were reached by navigating from the vendors' own sites. Two consequences: no source was found for how widespread each tool is in Germany, Austria and Switzerland (the list of tools is the ticket's own, prevalence **UNVERIFIED**), and for several vendors no developer documentation could be located, which is stated per vendor.

## Summary

- Of the eleven tools named in the ticket, **none has a verified connection to Channex**. Several appear in Channex's list of channel codes, but that list names booking sources and is not a list of connections.
- **CultBooking** (Berlin) is the one German booking tool verified on both sides as connected to Channex.
- Every named tool is sold together with its vendor's own channel manager, and its interface to a property management system is that channel manager's interface. Connecting such a tool directly therefore means building a second channel-manager integration, which the selection research already schedules after v1.
- Channex offers any booking tool a documented way to become a channel (Open Channel API). The work and the yearly fee of USD 300 fall on the tool's vendor, not on us.
- Metasearch sites are advertising, not a reservation source. The booking is made in whichever booking tool the click lands on.

## How the chosen channel manager admits a foreign booking tool

Two lists exist at Channex and they mean different things:

- **Integrations directory** (live connections Channex advertises). Its "IBE" section has seven entries: Alaric, Booknpay, Cultbooking, GuestTraction, Levart, Omnihotelier, WeSpeak. None of the tools named in the ticket is in the directory; of the seven, Cultbooking is the one verified here as a German vendor [C14][CB1].
- **Channel Codes** (three-letter source codes used to label where a booking originated). This list does contain `DRS - DIRS21`, `SMP - Simple Booking`, `FBK - Fastbooking` (D-EDGE's booking engine brand), `BBN/BBP - BookingButton` (SiteMinder's booking tool), `BKS - Bookassist`, `RTS - Kognitiv`, `CAE - Caesar Data`, `HNS - HotelNetSolutions`, `CSV - Clearing Station (Vioma)`, `CTZ - CultBooking`, `FER - Feratel Deskline`, `TMS - TOMAS Travel` [C13]. The page describes the codes as shortcodes "to easier match OTA to your system" taken from the first three letters of a booking's `unique_id`; the Open Channel documentation uses the same list for the `ota_name` a connecting system reports when it "passes bookings from 3rd party OTA" [C13][C17]. The Channel API separates the two as well: `GET /channels/codes` lists "the short codes and names of known booking channels", `GET /channels/list` lists "the descriptors of every supported channel adapter" [C20]. Many code and name pairs in the Channex list are identical to SiteMinder's Booking Agent Codes table, down to SiteMinder's own products (`GEN - GDS by SiteMinder`, `BBP - BookingButton Plus`, `CCT - BookingButton Cradle Coast Tourism`) [C13][S19]. **A code in this list is therefore a label for a booking source, not evidence that Channex operates a connection to that vendor.** The adapter catalogue itself needs an API key (the endpoint answers 401 without one), so it could not be read for this research: **UNVERIFIED**, and the first thing to check with our staging key. No mapping guide or channel example exists in the Channex documentation index for any of the tools named in the ticket; guides exist for Feratel, HRS, Check24, Google and the Channex "Instant Booking Page" [C18].

The documented way for a booking tool that is not yet a Channex channel to become one is the **Open Channel API**, "how to connect your OTA, booking engine or channel manager as a channel on Channex" [C17]. Taken from the raw documentation text:

- **Who builds it**: the booking tool vendor, not the PMS. The vendor exposes three endpoints (test connection, mapping details, changes) and pushes bookings to Channex. Channex states "we allow any channel to connect" and certifies any integration that passes its tests. Cost to the vendor: USD 300 per year, payable before certification [C17].
- **To the tool**: Channex pushes availability per room type and rate plan, and per rate plan the rate (per occupancy where the tool sells per person), stop sell, closed to arrival, closed to departure, minimum stay on arrival, minimum stay through, maximum stay. A tool that supports only one minimum-stay type receives a single `min_stay` field. The tool can request a full sync [C17].
- **From the tool**: bookings with status `new`, `modified` or `cancelled`; per room the room type code, occupancy (adults, children, infants), guest names, and a day-by-day list of price and rate plan code ("supports Mixed Rate Plans"); a `customer` object (the person who booked: name, address, e-mail, phone, language, company with tax number); `services` (type `Meal`, `Fee` or `Extra`, price mode, persons, nights, and an `excluded` flag saying whether the amount is on top of the room price); `guarantee` (card, including virtual-card fields); `deposits` (amount, currency, time charged, type, notes, payment-processor data); `payment_collect` (`ota` or `property`) and `payment_type` (`credit_card` or `bank_transfer`) [C17].
- **No tax fields** exist in the Open Channel booking message. A tool connected this way cannot state whether its prices include VAT or City Tax, other than through a `services` line or free-form `meta` [C17].
- **Card data** pushed by the tool is stored in Channex's PCI storage and released only to PMS partners that prove PCI DSS compliance (SAQ D service provider attestation) or use a tokenisation service; all others receive masked data [C5][C19].

Bookings from an Open Channel connection are bookings of a Channex channel and so reach the PMS through the same booking revisions feed as OTA bookings; the PMS needs no second ingestion path (inference from [C5][C17], not stated verbatim in either page). The PMS-side payload documents `payment_collect`, `payment_type`, `guarantee`, `services`, per-room `taxes` with `is_inclusive`, and a `deposits` list appears in the documented example payload; the field descriptions do not explain `deposits` on the PMS side, so how a tool's deposit is rendered there is **UNVERIFIED** beyond the example [C5].

## Website booking tools compared

"Channel list entry" quotes the Channex Channel Codes page [C13] and the Channex integrations directory [C14]. "Code only" means the name appears as a source code but no connection is documented.

| Vendor and tool | Reachable through Channex | Own interface to a property management system | Direction of data flows | Reservation data delivered | Payment handling | Partner terms and costs |
|---|---|---|---|---|---|---|
| **DIRS21** (booking engine "DIRS21 One", administered in the "Cockpit") | **No verified connection.** Code only: `DRS - DIRS21` [C13]; absent from the directory [C14] | SOAP web service, interface description publicly readable; the same service serves the DIRS21 channel manager [D1]. Vendor: "Set up an interface between your Property Management System and DIRS21" [D10] | To DIRS21: per room and day availability, price, minimum stay, closed to arrival, closed to departure; extended form per occupancy. Back: the PMS pulls pending bookings and confirms receipt [D1] | Per room and night a list of rates (code, quantity, number of persons, price, minimum and maximum age); add-ons with category (included, per day, per piece, mandatory and others) and price; third-party add-ons; totals for rooms, add-ons and overall; booker (`Customer`) separate from a list of `Guests`, each with name, company and address; card fields on the booker; channel name; cancellation terms; status Active, Cancelled, NoShow, Modified. **No tax element anywhere in the interface description** [D1] | "Pay & Secure": guest pays in the booking flow by card, PayPal and others. Either DIRS21 opens a payment account for the hotel with First Cash Solution and pays out to the hotel's company account (recommended every 14 days), or the hotel's existing payment provider is attached. Vendor states "Transferring all payment details to the PMS". Refunds are made in the Cockpit [D11]. The interface description carries payment records as third-party add-ons of category `HeidelpayCCPayment`, `HeidelpayCCPreAuthorize`, `HeidelpayBankPayment` [D1]; whether current payments use these categories is **UNVERIFIED** | Hotel pays DIRS21. Pay & Secure: set-up EUR 299 or EUR 249, 0.49 % per transaction plus provider fees [D11]. Interface to the hotel software "auf Anfrage ab EUR 295" [D4]. No public partner process |
| **HotelNetSolutions** "OnePageBooking" | **No verified connection.** Code only: `HNS - HotelNetSolutions` [C13]; absent from the directory [C14]. "Onepagebooking" has no code | XML interface, no public documentation; described by a PMS partner [H3] | To HNS: availability per room type, rates and restrictions, child prices (HNS must switch this on), prices from minimum to maximum occupancy. Back: the PMS pulls bookings every 5 minutes; a booking can be re-sent by setting it to "Unconfirm" in the HNS portal [H3] | Guests carry an age qualifying code; a child sent without age needs a fallback person group in the PMS [H3]. Further fields **UNVERIFIED** | "Credit card, PayPal, Klarna"; HNS "offers interfaces to the most relevant payment providers" [H6]. How a payment reaches the PMS: **UNVERIFIED** | Hotel pays HNS. No public pricing [H7]. No public partner process |
| **Seekda** (the ticket's "Seekda/Kognitiv"; booking engine "Kube") | **No verified connection.** Code only: `RTS - Kognitiv` [C13]; absent from the directory [C14] | "2-Wege-Schnittstelle" to third-party PMS; connectivity portal is behind a login, no public documentation [K1] | To Seekda: prices, availability, restrictions. Back: completed bookings are provided to the PMS [K1]. A PMS partner describes availability per room type, rates and restrictions for adults and children, bookings pulled [K2] | Extras arrive as fixed services identified by a name; the PMS must map each name to an article with a tax rate, otherwise the line is imported as undefined revenue, even at price 0 [K2]. Further fields **UNVERIFIED** | "Seekda Pay": online payment in the booking engine, card check, automatic charging, refunds, handling of OTA tokens and virtual cards [K4]. How a payment reaches the PMS: **UNVERIFIED** | Hotel pays Seekda; Apaleo listing shows a starting price of EUR 67 per month [K5]. Partner page exists, terms unpublished |
| **Hotel-Spider** (booking engine "Spider-Booking") | **No.** No code in the list [C13]; absent from the directory [C14] | "Bidirectional PMS integration with real-time sync"; no public documentation found [HS1] | Both directions, per vendor; details **UNVERIFIED** | **UNVERIFIED** | Guest pays in full or in part at booking. Card data and authentication tokens are stored at Hotel-Spider, purged 48 hours after departure; the front desk never sees card numbers [HS2] | **UNVERIFIED** |
| **D-EDGE** booking engine (formerly Fastbooking: SiteMinder names code `FBK` "D-EDGE (Old)" [S19]) | **No verified connection.** Code only: `FBK - Fastbooking` [C13]; absent from the directory [C14] | "two-way connectivity with more than 150 PMS"; no public documentation found [DE1] | Both directions, per vendor; details **UNVERIFIED** | **UNVERIFIED** | "D-EDGE Pay" collects payment at booking, more than 67 payment methods, payment dashboard for reconciliation [DE2] | **UNVERIFIED** |
| **Simple Booking** (QNT S.r.l., Florence) | **No verified connection.** Code only: `SMP - Simple Booking` [C13]; absent from the directory [C14] | Vendor names "2-way XML technology" and updates "on your PMS or booking engine"; no documentation found [SB1] | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | No prices on the pricing page [SB2] |
| **SiteMinder** booking engine | **No verified connection.** Codes only: `BBN - BookingButton`, `BBP - BookingButton Plus` [C13]; absent from the directory [C14] | pmsXchange, publicly documented (see selection research). Bookings of the booking engine arrive in the normal reservation messages under agent code `BBN`, "Direct Booking" [S19] | As for pmsXchange | As for pmsXchange | Payments taken through SiteMinder Pay are pulled by the PMS as "Payment Transaction Record", linked to the reservation by a payment context identifier; several payments per reservation are possible [S20] | As for pmsXchange: partnership agreement, certification |
| **Cubilis**, now Lighthouse "Direct Bookings" | **No.** No code in the list [C13]; absent from the directory [C14] | Partner-gated interface (see selection research); nothing further found [L8] | **UNVERIFIED** | **UNVERIFIED** | Vendor advertises "Direct Bookings & Payments" [L8]; details **UNVERIFIED** | See selection research |
| **Bookassist** | **No verified connection.** Code only: `BKS - Bookassist` [C13]; absent from the directory [C14] | No public page on PMS connections found (candidate URLs returned 404) | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** |
| **Caesar Data** | **No verified connection.** Code only: `CAE - Caesar Data` [C13]; absent from the directory [C14] | The site forwards to SoftTec GmbH, a PMS vendor whose booking system shows "Live-Verfügbarkeiten aus der Hotelsoftware" [CD1]; SiteMinder names the same code "hotline hotel software booking system" [S19]. It is the booking page of a competing PMS, not a tool a hotel would keep beside ours. Interface for a foreign PMS: **UNVERIFIED** | not applicable | not applicable | "SoftTec Payment" [CD1] | **UNVERIFIED** |
| **CultBooking** (Cultuzz Digital Media, Berlin); not in the ticket's list | **Yes.** Directory, section IBE: "Cultbooking" [C14]; code `CTZ - CultBooking` [C13]. CultBooking lists Channex among its connected channel managers [CB1] | "open API and 2-way XML"; no public documentation found [CB1] | Through Channex: availability, rates, restrictions to the tool; bookings, modifications, cancellations back. Whether CultBooking uses the Open Channel message described above is **UNVERIFIED** | As delivered by the Channex booking feed [C5] | Payment gateways Mollie and Stripe; "accept automatic payments to your bank account" [CB2][CB3] | Hotel pays CultBooking: EUR 29 per month per property, integration with PMS and channel manager included [CB3]; payment gateway add-on "partner fees apply + EUR 99 (one time setup)" [CB2] |
| **Any other tool**, through the Channex Open Channel API | **Yes, once its vendor has built and certified the connection** [C17] | not needed | See the section above | See the section above | `deposits`, `payment_collect`, `payment_type`, card in Channex's PCI storage [C17] | Vendor pays Channex USD 300 per year; certification by Channex [C17] |

Two observations that hold across the table:

1. **Booker and guest** are separate in both interfaces that could be read: Channex `customer` beside per-room `guests` [C17], DIRS21 `Customer` beside `Guests` [D1]. In the Open Channel message only the booker's surname is mandatory; e-mail, phone and guest names are optional [C17].
2. **Taxes are not stated** by either interface that could be read from the tool's side. The Channex feed towards the PMS has per-room `taxes` with `is_inclusive`, but the Open Channel message a tool sends has no field to fill them [C5][C17].

## Are metasearch sites channels of the chosen channel manager?

**Google: yes, with a restriction. trivago and Tripadvisor: no.**

- The Channex integrations directory contains "Google Hotels & Vacation Rentals" and no entry for trivago, Tripadvisor, Kayak or any other metasearch site [C14]. The channel codes contain `GHA - Google Hotel Ads (through Channex.io)` and `TRA - Tripadvisor Feed Channel`, and no trivago code [C13]. Whether the Tripadvisor code corresponds to a working connection is **UNVERIFIED**.
- The Google connection puts the property into Google's free booking links; a Google Ads account can be linked for paid placement. Under Channex's own Google account the link must lead to the Channex "Instant Booking Page". A different booking page may be used only with an own Google Hotel Centre, for which Channex names more than 25 properties and an agreement with Google as preconditions [C21].
- A metasearch site is not where the reservation is made. trivago describes its standard interface as "a direct connection to your booking engine / reservation system" that requests live prices at each search; on a click the user is "re-directed to the hotel website" and continues the booking there. trivago charges per click or a percentage per booking [T1][T2]. trivago also announces "Express Booking", in which trivago handles the booking step; its documentation page returned 404 [T3], details **UNVERIFIED**.
- The foreign booking tools sell metasearch connectivity themselves: DIRS21 (Google, trivago, Tripadvisor, Google free links) [D10], Seekda (Google, Idealo, Tripadvisor, trivago, Wego, including trivago Express and Tripadvisor Instant Booking) [K3], Hotel-Spider (Google Hotel Ads and trivago; "they land on your booking engine") [HS3], D-EDGE (Google Hotel Ads, Kayak, Skyscanner, Tripadvisor, trivago and others) [DE3], Simple Booking (Tripadvisor, Google, trivago) [SB3].

Consequence: a hotel that keeps a foreign booking tool gets its metasearch presence from that tool's vendor, and such a booking reaches us as a booking of that tool. Whether the tool passes on which metasearch site the guest came from is **UNVERIFIED** for every tool. For comparison, SiteMinder's code table has separate codes for trivago, Tripadvisor cost-per-click, Google Hotel Ads and Bing Hotel Ads [S19].

## Payments taken by the foreign tool and the folio

What the sources establish:

- Where the payout is documented, the money goes to the **hotel's own account at a payment provider**, not to us and not to the tool's vendor as seller: DIRS21 pays out to the hotel's company account or uses the hotel's existing provider [D11]; CultBooking uses the hotel's Mollie or Stripe gateway [CB2][CB3]. For the other vendors the payout path is **UNVERIFIED**.
- Through Channex a tool reports money already taken as `deposits` (amount, currency, time charged, free-form type such as `credit_card`, `cash`, `bank_transfer`, notes, payment-processor data) and states who collects the rest with `payment_collect` and `payment_type` [C17].
- Card numbers are released by Channex only to partners with proof of PCI DSS compliance or a tokenisation service [C19]. The selection research already decided that v1 takes no card data from Channex. Channex documents a "Payment Application" that charges a stored card through Channex into the property's Stripe account for a fee [C22]; not evaluated here.
- Refunds of money taken by the tool are made in the tool (DIRS21: from the booking list in the Cockpit, also automatically on cancellation) [D11].

How it would appear on our folio, following the folio decisions already taken (money received before check-in is a Payment and triggers a Deposit Invoice):

- One **Payment per reported deposit**, with a Tender of its own, for example "Paid in external booking tool", carrying the tool's reference and time of charge. It must be distinguishable from "card online", because the money is not in the account of our payment provider and must stay out of that reconciliation.
- The Payment is recorded, not executed. A refund is made in the foreign tool and recorded on the folio as a negative Payment with the same Tender.
- Whether a deposit reported by a foreign tool obliges the hotel to issue a Deposit Invoice from our system, or whether the tool has already issued a document, belongs to "Tax advisor confirmation of fiscal and voucher rules". **UNVERIFIED** here.

## Recommendation for v1

1. **One way in: the Channex booking feed.** A foreign booking tool is connected in v1 only as a channel of Channex. Bookings then arrive, are modified and cancelled exactly like OTA bookings, and availability, rates and restrictions reach the tool through the rate push that exists anyway. No second ingestion path, no second certification.
2. **Support list for v1**: tools that are Channex channels. Verified today: CultBooking. Before anything is promised to a hotel, read the adapter catalogue with our staging key (`GET /api/v1/channels/list`) and ask Channex support which booking tools are connected; the public sources do not settle it.
3. **Vendors of other tools are pointed to the Channex Open Channel API.** It is documented, open to any channel, and costs the vendor USD 300 per year. This makes "connect your existing tool" possible without work on our side, but the timing is in the vendor's hands.
4. **No direct integration with DIRS21, HotelNetSolutions, Seekda, Hotel-Spider, D-EDGE, Simple Booking or SiteMinder in v1.** Each of these is the vendor's channel manager with a booking page attached; integrating one is the second channel-manager integration. The selection research already names DIRS21 as the first candidate after v1; since the DIRS21 booking engine and channel manager share one interface, that one integration would cover both.
5. **No interface of our own published in v1.** If one is wanted later, adopt an existing message format instead of inventing one: the Channex Open Channel format is what our feed already speaks, and AlpineBits HotelData is an open standard for availability, rates and reservations with more than 125 known implementations [AB1]. Which booking tools implement AlpineBits is **UNVERIFIED**.
6. **Hotels whose tool cannot be reached in v1** have two honest options: use our booking page, or keep the tool unconnected and enter its bookings by hand under a Source of their own. The second carries an overbooking risk, because the tool does not learn our availability. This should be said plainly in onboarding.
7. **One distributor per sales channel.** A hotel that keeps a vendor's booking page usually also has that vendor's channel manager. Running it beside Channex means two systems could feed the same OTA. Onboarding must establish which system feeds which channel. That an OTA accepts only one connected system per property is **UNVERIFIED** here.

Confidence: **high** that the Channex feed is the right single entry point and on what it delivers; **medium** on the support list, because the authoritative adapter catalogue could not be read; **low** on the details of the vendors without public documentation.

## Constraints on the reservation, rate and folio models

Derived from the Channex feed and Open Channel message, which is the recommended path, with DIRS21 noted where it differs.

Reservation model

1. **Source has two parts**: the connection the booking came through (Channex) and the originating channel (code and name from the booking's `unique_id` and `ota_name`). Foreign website tools form their own class of Source, "website, external tool", separate from OTA and from our own Booking Engine [C5][C13].
2. **Commission is optional.** Channex delivers a commission amount only for Booking.com and Airbnb; a website tool delivers none [C5].
3. **Identity and idempotency**: store the revision identifier and the channel's reservation code. A tool may send a new booking without its own reservation number, in which case Channex generates one [C17].
4. **Three revision states**: new, modified, cancelled; each revision is a complete booking. DIRS21 additionally reports NoShow [C5][D1].
5. **Booker is separate from guests.** The booker may carry a company with tax number. Guests may be absent or be names only. Only the booker's surname is guaranteed; e-mail and phone can be missing, so confirmation, Portal Link and Pre-check-in cannot be assumed deliverable [C17].
6. **Several rooms per booking**, each with its own occupancy, guests, services and nightly prices [C5][C17].
7. **Rate plan per night, not per reservation**: the message allows a different rate plan on each night of one room [C17].
8. **Occupancy arrives as adults, children, infants** with the channel's own age limits (Open Channel: children 2 to 16, infants under 2), sometimes with a list of ages. Mapping to the property's Age Bands needs a fallback when ages are missing [C5][C17][H3].
9. **Unmapped rooms and rates are possible**: the feed delivers a booking even if its room type or rate plan is not mapped, with empty identifiers. The reservation model needs a state for "arrived, not yet assignable" [C5].
10. **Prices are taken as delivered.** The nightly price in the booking is what the guest was shown; it is stored and never recomputed from our rates, in line with "reservations keep their prices".
11. **Extras arrive as named lines** (type Meal, Fee or Extra; price mode per stay, per night, per person, per person per night; persons, nights, room, applicable date; flag whether the amount is on top of the room price). Each property needs a mapping from external name to our Service with its Tax Code, and a visible fallback for unmapped lines [C17][K2].
12. **A cancellation fee can arrive as a service line on a cancelled booking**, so Charges must be postable to a cancelled reservation [C17].

Rate model

13. **The tool receives only what is projected to Channex**: absolute prices per pair of rate plan and room type, per occupancy where the tool sells per person, in one currency. Derived plans and Supplements must already be resolved, as decided [C17].
14. **Child prices are not part of the message to the tool**; it carries one price per number of persons. Child pricing by Age Band has to be configured in the tool, and the booked price may differ from what our rates would compute. Constraint 10 covers this [C17].
15. **Both minimum-stay rules are sent**; a tool that knows only one receives a single value, arranged with Channex per channel [C17].
16. **Which rate plans a tool sells is a mapping per channel**, kept at Channex. "Sold on channels" on the rate plan is therefore a precondition, not the full answer; the choice per channel lives in the mapping [C17][C20].
17. **Policies, texts, Rate Codes, Held Rooms and vouchers are not transported.** Payment Policy and Cancellation Policy must be set up a second time in the foreign tool, and a booking from the tool carries no structured policy. The policy applied by us is the one of the mapped rate plan. DIRS21 does deliver cancellation terms with the booking [C17][D1].
18. **No hold on inventory.** Channex offers the tool an availability check before booking, which reserves nothing. Overbooking in the gap is possible and the reservation model must accept a booking that exceeds availability [C17].

Tax and folio model

19. **Whether prices include VAT and City Tax is a setting per channel.** A website tool connected through Open Channel cannot state it in the booking. This is the per-channel default already decided in "City tax rule configuration"; for such tools it is the only source [C17].
20. **Money taken by the tool is a Payment with its own Tender**, recorded from the reported deposit, excluded from reconciliation with our payment provider, refundable only outside our system.
21. **Who collects the remainder** is stated per booking (`payment_collect`: property or channel; `payment_type`: card, bank transfer or unstated) and must be stored on the reservation [C5].
22. **A card guarantee from a foreign tool cannot be charged by us in v1**, since card data is not released to us. A Payment Policy "Card Guarantee" on such a booking is a statement, not a usable guarantee; a no-show fee has to be charged in the tool or requested from the guest [C19].
23. **A modification can lower the total below the deposit already taken.** The folio must show the overpayment and wait for a refund recorded from outside.
24. **Booking currency is stated per booking** and may need checking against the property currency [C17].

## Sources

All retrieved 2026-09-29 unless a date is given.

Channex
- [C5] Bookings Collection (payload fields, `payment_collect`, `payment_type`, `ota_commission`, taxes with `is_inclusive`, collected taxes, unmapped rooms, card data rules): https://docs.channex.io/api-v.1-documentation/bookings-collection
- [C13] Channel Codes: https://docs.channex.io/api-v.1-documentation/channel-codes
- [C14] Integrations directory (section IBE with seven entries; Google Hotels & Vacation Rentals): https://channex.io/integrations.md
- [C17] Open Channel API (cost, endpoints, changes message, push booking message, availability check): https://docs.channex.io/for-ota/open-channel-api and introduction https://docs.channex.io/for-ota/intro
- [C18] Documentation index (which mapping guides and channel examples exist): https://docs.channex.io/llms.txt
- [C19] Guide to PCI: https://docs.channex.io/guides/guide-to-pci
- [C20] Channel API (`/channels/codes` against `/channels/list`, mapping per channel): https://docs.channex.io/api-v.1-documentation/channel-api ; unauthenticated call to https://staging.channex.io/api/v1/channels/list answered 401
- [C21] Connect Google Channel (free links, booking link, Hotel Centre condition): https://docs.channex.io/google/google-hotel-ads ; Instant Booking Page: https://docs.channex.io/channel-mapping-guides/instant-booking-page
- [C22] Payment Application API: https://docs.channex.io/api-v.1-documentation/payment-application-api

SiteMinder
- [S19] Booking Agent Codes: https://developer.siteminder.com/pmsxchange-api/additional-resources/reference-tables/booking-agent-codes
- [S20] Payment Transaction Record: https://developer.siteminder.com/pmsxchange-api/reference/payment-transaction-record

DIRS21
- [D1] Interface description of the DIRS21 PMS web service, reservation types read from the raw file: https://pmsif.dirs21.de/DirsWS_V2.asmx?WSDL
- [D4] DIRS21 price list, as cited in `channel-manager-selection.md` (not fetched again)
- [D10] DIRS21 One product page (PMS interface, metasearch package): https://www.dirs21.de/en/direct-bookings-one/
- [D11] DIRS21 Pay & Secure (fees, payout, refunds, transfer of payment details to the PMS): https://www.dirs21.de/en/landing-pages/pay-secure/

HotelNetSolutions
- [H3] CASABLANCA documentation of the HNS interface: https://docs.casablanca.at/cloud/interfaces/hns/
- [H6] OnePageBooking product page: https://hotelnetsolutions.de/en/products/onepagebooking/
- [H7] OnePageBooking on the Apaleo Store ("has not shared public pricing"): https://store.apaleo.com/apps/onepagebooking

Seekda
- [K1] PMS connectivity: https://www.seekda.com/products-pms-connectivity/ ; connectivity portal forwards to a login: https://connectivity.seekda.com/
- [K2] CASABLANCA documentation of the Seekda interface: https://docs.casablanca.at/cloud/interfaces/seekda/
- [K3] Metasearch: https://www.seekda.com/products-metasearch/
- [K4] Seekda Pay: https://www.seekda.com/products-seekda-pay/
- [K5] Seekda on the Apaleo Store: https://store.apaleo.com/apps/seekda

Hotel-Spider
- [HS1] PMS connectivity: https://www.hotel-spider.com/pms-connectivity/
- [HS2] Payment services: https://www.hotel-spider.com/payment-services/
- [HS3] Metasearch connectivity: https://www.hotel-spider.com/meta-search-connectivity/

D-EDGE
- [DE1] Connectivity: https://www.d-edge.com/product_family/connectivity/
- [DE2] Payment solutions: https://www.d-edge.com/product/payment-solutions/
- [DE3] Metasearch marketing: https://www.d-edge.com/product/metasearch-marketing/

Simple Booking
- [SB1] Channel manager page: https://www.simplebooking.travel/solutions/channel-manager
- [SB2] Pricing page: https://www.simplebooking.travel/pricing
- [SB3] Metasearch platforms: https://www.simplebooking.travel/solutions/metasearch-platforms

CultBooking
- [CB1] Developers and partners (channel managers list including Channex): https://www.cultbooking.com/en/developers-connect/
- [CB2] Pricing: https://www.cultbooking.com/en/pricing/
- [CB3] CultBooking on the Apaleo Store: https://store.apaleo.com/apps/cultbooking

Others
- [L8] Lighthouse Direct Bookings: https://www.mylighthouse.com/platform/direct-bookings
- [CD1] caesar-data.com forwards to SoftTec GmbH; page read over http because the https connection failed: http://www.caesar-data.de/
- [T1] trivago FastConnect overview: https://developer.trivago.com/fastconnect/fast-connect-overview.html
- [T2] trivago, get listed (cost per click and cost per acquisition): https://company.trivago.com/get-listed/
- [T3] trivago Connectivity Suite (Express Booking announced; its overview page returned 404): https://developer.trivago.com/
- [AB1] AlpineBits HotelData: https://www.alpinebits.org/open-standard/hotel-data/

Not retrievable after two attempts: developer sites guessed for D-EDGE, Hotel-Spider and Simple Booking (no response), Bookassist pages on integrations (404), https://www.dirs21.de/en/booking-engine/ (404).
