# Search visibility decisions

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 46

## Question

With the research in hand, decide what the hosted booking pages ship in v1 for being found: structured data, page content the hotel edits, language versions, address scheme under the hotel's own domain, free booking links through the channel manager or directly, tracking of where bookings come from, and cookie consent.

From the research: free booking links through the chosen channel manager land on the channel manager's own booking page, not on ours, until an own account with the search engine is approved (offered above 25 properties). Decide whether hotels may switch that on at launch, when to apply for an own account, whether to point hotels to manual rates in their business profile, and where the Inventory Hold starts.

## Answer

Resolved 2026-09-29 by grilling. The owner ruled during this ticket that the product has **no booking page**: "hotels shall be booked via the hotel's own website or booking.com, expedia or the likes of that. We only provide software for hotel management, not the interface for people booking." Confirmed in a follow-up: the Guest Portal and Self Check-in stay, because they serve existing bookings.

What remains of this ticket:
- **Google as a channel**: a hotel may switch Google on as a channel of the channel manager. Guests clicking a free booking link then book on the channel manager's own booking page and the booking arrives like any channel booking, Source Google. The setting says so plainly. Once we pass 25 properties we apply for our own Google account; the landing page question is revisited then.
- Structured data, language versions, deep links, source tracking, Inventory Hold start and cookie consent on our pages: no longer apply.
- The Guest Portal and Self Check-in carry no tracking cookies.
