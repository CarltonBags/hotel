# Card transfer between providers and re-delivery of existing channel bookings

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

For the day a hotel switches to us, establish from primary sources: (1) whether our card provider imports stored cards from another security-certified provider or card vault, what it requires, how long it takes, whether it works for hotels that are connected accounts on a platform, and what comes back (tokens, and whether they may be charged without the guest present and with which authentication status); (2) what the chosen channel manager delivers for bookings that already exist at the booking sites when a property is connected: whether existing future reservations are delivered, in which form, and whether per-night prices and guest data are complete; (3) how OTA virtual cards are obtained for such existing bookings: through the channel manager's secure card interface (and what certification that demands of us), or only through each booking site's extranet; activation dates and validity of virtual cards. Conclude with what is possible at the switch without card numbers passing through our system, and the constraints on the import and on Card Guarantees.

## Answer

Resolved 2026-09-29 by research. Findings: [card-transfer-and-channel-redelivery.md](../../../docs/research/card-transfer-and-channel-redelivery.md)

1. **Card transfer**: possible. Stripe imports cards provider to provider on request; the old provider needs days to weeks, Stripe typically 10 business days after correct data. It returns a mapping of old IDs to tokens, without authentication status. Tokens may be charged without the guest present, but the bank may still demand authentication. For hotels as connected accounts only the copy between Stripe accounts is documented; card import from a foreign provider into a connected account is UNVERIFIED and needs Stripe's written confirmation.
2. **Existing channel bookings**: not delivered by themselves. Channex fetches future reservations on request for Booking.com, Expedia, Airbnb, Ctrip and Despegar; not for Agoda, HRS undocumented. The Booking.com fetch lacks guest contact data, taxes and fees, commission and card details. Whether it enters the revisions feed and whether prices per night are complete is UNVERIFIED (test on staging).
3. **Virtual cards of existing bookings**: only from the booking site's extranet. Booking.com sends card details in the first pull only, which went to the old channel manager. Channex's secure card interface demands a service provider attestation (SAQ D, Level 1 or 2, under 12 months old); its Stripe Tokenization App needs none but serves only bookings arriving after connection. Booking.com virtual cards: usable from the activation date (booking date for non-refundable, otherwise when 90% non-refundable, or one day after check-in), until 12 months after check-out; no holds. Expedia UNVERIFIED.
4. **At the switch**: our import from the old system is the source for existing reservations; the channel fetch is a cross-check. Transfer of guest cards must start about two months earlier. Virtual cards are keyed by staff from the extranet into a Stripe-owned entry.
5. **Constraints**: the import carries the old provider's card reference and the channel booking number; Card Guarantee starts "not secured", becomes "transferred, not yet verified", and "secured" only after a successful hold or charge; a Card Guarantee kind "virtual card at booking site" with activation date, expiry and balance, charge only.
