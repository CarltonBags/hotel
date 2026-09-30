# How a hotel's existing website booking tool delivers reservations

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

The owner decided on 2026-09-29 that our booking page is optional: a hotel may keep the booking tool its website already has, from another vendor, and connect it. Establish from primary sources how website booking tools used by hotels in Germany, Austria and Switzerland exchange data with a property management system: which tools are common (for example DIRS21, Simple Booking, D-EDGE, SiteMinder's booking tool, Cubilis, Bookassist, Hotel-Spider, Seekda/Kognitiv, Onepagebooking, Caesar Data, HNS); whether each is reachable as a channel through the chosen channel manager (check its channel list) or only through its own interface; what flows in each direction (availability, rates and restrictions to the tool; reservations, modifications and cancellations back); what reservation data arrives (rate plan, per-night prices, taxes and whether included, extras, guest details, payment or card guarantee data, booker against guest); how payments taken by the foreign tool reach the hotel and how they would appear on our folio; certification, partner terms and costs. Also check whether metasearch sites such as trivago count as channels of the chosen channel manager. Recommend how v1 connects foreign booking tools and list constraints on the reservation, rate and folio models.

## Answer

Resolved 2026-09-29 by research. Findings: [foreign-booking-tools.md](../../../docs/research/foreign-booking-tools.md).

- **Recommendation**: in v1 a foreign booking tool connects only as a channel of the chosen channel manager, so its bookings arrive through the booking feed we build anyway. No direct integration with a tool vendor and no interface of our own in v1.
- **Finding that limits this**: none of the eleven named tools has a verified connection to the chosen channel manager. They appear in its list of channel codes, which labels booking sources and is not a list of connections. Verified as connected: CultBooking. The authoritative adapter catalogue needs our API key and must be read before anything is promised (UNVERIFIED).
- Each named tool is its vendor's channel manager with a booking page attached; integrating one directly is a second channel-manager integration (DIRS21 first, after v1). Other vendors can join through the channel manager's Open Channel API at their own cost (USD 300 per year).
- **Metasearch**: Google is a channel, but only with the channel manager's own booking page unless the account holds its own Google Hotel Centre. trivago and Tripadvisor are not channels. Metasearch sites send the guest to a booking tool; they do not deliver reservations.
- **Key constraints**: Source in two parts with an own class for external website tools; booker separate from guests, with only the booker's surname guaranteed; rate plan per night; prices stored as delivered; extras as named lines needing a mapping to Services with Tax Code; VAT and City Tax inclusion is a setting per channel because the tool cannot state it; money taken by the tool is a Payment with its own Tender, recorded and refunded outside our payment provider; a card guarantee from the tool cannot be charged by us.
- Web search was unavailable during the research; vendors without public documentation are marked UNVERIFIED in the findings.
