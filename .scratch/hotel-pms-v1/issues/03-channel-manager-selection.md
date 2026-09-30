# Channel manager selection

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

Which third-party channel manager should v1 integrate for two-way sync of rates, availability and reservations with OTAs, for European independents and small chains up to 400 rooms per property? Compare candidates that expose a PMS-partner API (e.g. Channex.io, SiteMinder, Cubilis, DIRS21, HotelNetSolutions, Apaleo-connected options). Report: API model (push vs pull, webhooks), rate/restriction concepts they impose on the PMS (rate plans, derived rates, min stay, CTA/CTD), certification requirements, pricing and partner terms, DACH market presence. Recommend one and name the constraints it puts on the rates model.

## Answer

Integrate **Channex.io** for v1. It is the only candidate with fully public REST docs, a free staging sandbox, a published 14-test certification (no fee, no contract needed to start) and a wholesale/white-label model where the PMS bills the hotel (USD 130/month platform + USD 7/property). DACH coverage is adequate (HRS, Booking.com, Expedia, Airbnb, Google; DIRS21/TOMAS/Feratel channel codes); Hotel.de coverage via HRS and EU data residency are UNVERIFIED and must be confirmed contractually.
Runner-up: SiteMinder pmsXchange (SOAP/OTA XML, partnership agreement, ~60 days to production, mapping owned by SiteMinder, arrival-based min stay only, no derived rates). DIRS21 is the natural second adapter for German independents (5,300+ customers) but its SOAP API is undocumented publicly (V2 WSDL reachable, 11 operations) and hotels pay an "on request" PMS-interface fee. HNS and Cubilis/Lighthouse have no public partner program.
Key constraints on the rates model: Property → Room Type → Rate Plan; availability on room type only, rates/restrictions on rate plan; per_room vs per_person sell mode with (occupancy, price) options and a primary occupancy; derived rate plans via parent + amount/percent modifiers + per-field inherit flags, but the PMS must also be able to materialise derived rates to absolute daily values (SiteMinder/DIRS21 cannot derive); restriction vocabulary stop_sell, CTA, CTD, min_stay_arrival, min_stay_through, max_stay (degrade to arrival-based on other adapters); one ISO currency per rate plan, gross/net flag; ≤20 room types and ≤200 rate plans per property; delta-only, event-driven ARI outbox (max 10+10 calls/min/property, nightly full push allowed); ack-based idempotent booking ingestion keyed by booking_revision_id; no card data in v1 (PCI-gated endpoint).
Full comparison and sources: ../../../docs/research/channel-manager-selection.md
