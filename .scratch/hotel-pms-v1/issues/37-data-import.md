# Data import from a previous system

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

What can a new customer bring along? Decide: which objects are imported (future reservations, in-house guests, guest profiles, companies, rates, open deposits, vouchers in circulation), the formats accepted (spreadsheet templates, exports of named systems), validation and the preview before import, handling of duplicates, what is never imported (card data, past invoices), the cut-over day procedure, and who does the work (customer with a guide, or us as a service).

From "Onboarding and subscription": import happens while the tenant is in Test Mode, before Go-live; imported records are real, not test records, and must survive the clearing at Go-live.

## Answer

Resolved 2026-09-29 by grilling. Two points on cards wait for research; see the end.

**What can be imported**
- Reservations with departure on or after the go-live day, including in-house guests: room assignment, price per night, guests, Source, notes, channel booking number.
- Guest profiles and Companies: names, contact data, Country of Residence, preferences, billing data and payment terms. Marketing consent only together with its proof.
- Money: open deposits on future reservations, balances of in-house guests, unpaid company invoices as opening Receivables, Vouchers in circulation with remaining value.
- Rates and Restrictions per rate plan and room type for the horizon.
- History as **daily figures only**, up to 3 past years, per day and room type: rooms sold, rooms available, Net Room Revenue, total revenue. This feeds last-year comparison and pace.

**Never imported**
- Past reservations, folios, invoices and receipts. They belong to the old system's numbering and fiscal records; the hotel keeps that system or its archive for its retention duty.
- Identity document data and registration records. They stay in the old system until their deletion date.
- User accounts and passwords. Users are created fresh.
- Card numbers and card data; see below.

**Formats**: our spreadsheet templates, one per object, with documented columns. Converters for named old systems are added as customers bring them, starting with the first pilot customers. No named system is promised at launch.

**Who**: the import screen is part of the product, for Property Manager and Tenant Admin. During assisted go-live our staff usually run it with the customer. Large or messy imports as a paid service.

**Checking**: every upload is first a dry run. The report lists rows as ok, warning or blocking: unknown room type or rate plan, overlapping reservations in one room, more rooms sold than exist, missing mandatory fields, invalid dates, deposits without reservation. Import runs only when no blocking error remains. Each import batch can be undone as a whole until Go-live.

**Duplicates**: detected in the dry run by the rule used in daily work (email, phone, name plus date of birth). Certain matches are merged automatically, keeping the most complete data. Doubtful matches are listed and decided by a person before import. The old system's guest number is kept on the profile as reference.

**Switching day**
1. Rehearsal import about a week before.
2. On the day, the old system runs its last night audit and the export is taken.
3. Final import runs. Imported records are real records and survive the clearing of test records at Go-live.
4. Staff check arrivals and the in-house list against lists printed from the old system.
5. Channels are switched to us. Go-live.
- In-house guests arrive as Checked-in, with their balance as an opening entry.
- For a stay that began in the old system, we invoice only nights from Go-live on; earlier nights are invoiced by the old system.
- No period of running both systems in parallel.

**Cards**
- Card numbers never pass through our import, spreadsheets or screens. The system holds tokens only.
- Where the hotel's old card provider is security-certified, cards may be handed directly to our card provider, which returns tokens. Whether this is offered for hotels on a platform account is unverified.
- Otherwise guests receive a Portal Link to store a card again. Until then the Card Guarantee of an imported reservation is marked "not secured" and listed for staff.
- **Open**: OTA virtual cards on imported channel reservations. The owner decides after research. Ticketed as "Cards and channel bookings at the switch".

> Update 2026-09-29 from "Card transfer between providers and re-delivery of existing channel bookings": the reservation template must carry the old card provider's customer or card reference and the channel booking number. The first full availability push to the channel manager is computed from our imported reservations.
