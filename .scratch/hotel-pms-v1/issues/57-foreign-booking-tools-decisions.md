# Connecting a hotel's existing website booking tool

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 56

## Question

With the research in hand, decide: through what foreign website booking tools connect in v1 (as channels of the channel manager, through an own published interface, or both); how such bookings appear (Source, commission, payment already taken elsewhere, City Tax included or not, per the rule in "City tax rule configuration"); what the guest of such a booking gets from us (confirmation, Portal Link, Pre-check-in) and what stays with the foreign tool; which features need our own booking page and are unavailable otherwise (Rate Codes drawing from Held Rooms, online voucher sale, self-service date change); and how a property switches our booking page on or off.

From the research: in v1 a foreign booking tool can connect only as a channel of the channel manager; none of the eleven named tools has a verified connection there, only one other tool is verified on both sides; the channel code list names booking sources and is not a list of connections, and the authoritative catalogue needs a key to read. Each named tool is its vendor's channel manager with a booking page attached. A foreign tool cannot state whether its prices include VAT or City Tax, so that is a setting per channel. Money taken by a foreign tool goes to the hotel's own account and appears on our folio as a recorded Payment; a card guarantee from a foreign tool cannot be charged by us. trivago and Tripadvisor are not channels and deliver no reservations.

> Update 2026-09-29: with no booking page of ours, connecting the hotel's own website tool is the only route for direct online bookings. The question which features "need our own booking page" falls away.

## Answer

Resolved 2026-09-30 by grilling.

- **Route**: a hotel's own website booking tool connects only as a channel of the channel manager. Its bookings arrive through the same feed as booking sites, Source Channel with the tool's name. No direct vendor interfaces and no own booking interface in v1.
- **Verification at onboarding**: before a hotel signs, we check in the channel manager's catalogue (needs our access key) that its tool is connected. If not, the tool's vendor can join the channel manager's open channel programme; timing is theirs. The go-live checklist gains "website booking tool connected and a test booking received".
- **City Tax and VAT inclusion**: a setting per channel, set at onboarding; the rule of "City tax rule configuration" then splits backwards or adds on top.
- **Payments taken by the tool**: recorded as a Payment with the Tender "paid via website tool"; refunds happen in the tool or the hotel's own payment account. A card guarantee held by the tool cannot be charged by us; if the property wants one, the guest is asked through the Portal to store a card.
- **Guest side**: the tool sends its own confirmation; ours is off by default for channel bookings and can be switched on. Pre-arrival invitation, Portal, Pre-check-in and Self Check-in work as for any booking with an email address.
