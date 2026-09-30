# Search visibility of hosted booking pages

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

How do hosted booking pages get found and compared? Report from primary sources: structured data for hotels and offers that search engines read, requirements for pages under the hotel's own domain (performance, language versions, canonical addresses), free booking links and paid hotel ads in hotel search (eligibility, price accuracy rules, feed or connectivity partner needed, whether the chosen channel manager provides it), and what metasearch sites require. Recommend what v1 should build and what it should leave to the channel manager.

## Answer

Resolved 2026-09-29 by research. Findings: [search-visibility.md](../../../docs/research/search-visibility.md)

- **Recommendation**: v1 builds the page side only: an indexable, server-delivered entry page per property and language with `Hotel` markup, a deep link entry into rooms-with-rates (dates, guests, child ages, language, optional room type and rate plan), and the total-price display already decided in ticket 14. v1 builds no price feed and no metasearch integration; price delivery to Google stays with Channex.
- **Main limit**: Channex is a Google connectivity partner for free booking links, but on its shared Hotel Center account the link must land on the Channex Instant Booking Page. Landing on our hosted pages needs an own Hotel Center account, which Channex offers above 25 properties and Google must approve.
- **Price rules**: the total on the landing page must equal the price sent to Google for the same dates, occupancy and currency, include every mandatory tax and fee (VAT, City Tax), and be visible before guest data is requested. A missing rate or room counts as an accuracy violation; low accuracy switches links and ads off.
- **Page rules**: one address per language, no automatic language redirect, `hreflang` in both directions with self-reference, canonical per language, `noindex` from guest details onward, usable within 10 seconds, the requested stay never re-entered, optional extras never preselected, Inventory Hold only after the last crawlable price summary.
- **Left out of v1**: direct Google integration, trivago, Tripadvisor, Bing, Kayak and paid hotel ads. None of the metasearch sites other than Google is offered by Channex.
- **For the decisions ticket (47)**: allow the Channex Instant Booking Page for Google at launch or not; when to apply for an own Hotel Center account; whether to point hotels to manual rates in their Google Business Profile.
- **UNVERIFIED**: price markup format (Google's two documents disagree: Microdata versus JSON-LD), paid ads through Channex, currency handling when Google converts, Tripadvisor and Kayak requirements (documentation closed or blocked).

> **Superseded 2026-09-29.** The owner ruled that the product has no booking page: guests book through the hotel's own website tool, booking sites through the channel manager, or staff. Kept as record. Only the part on free booking links through the channel manager still matters.
