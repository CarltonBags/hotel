# Cards and channel bookings at the switch

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 59

## Question

With the research in hand, decide what happens to stored cards and to OTA virtual cards of imported reservations on the switching day: provider-to-provider transfer offered or not; how imported channel reservations are matched with what the channel manager delivers, to avoid doubles; whether virtual cards are fetched by staff from each booking site or arrive otherwise; how "not secured" Card Guarantees are worked off.

From the research: card import from another provider is an established procedure at our card provider, but into a hotel's connected account it is unverified and needs the provider's written confirmation; it takes weeks, so it must start about two months before the switch, with a cut-off date. The channel manager delivers existing future bookings only on an explicit fetch, for five booking sites; the largest site's fetch lacks guest contact data, taxes and card details. Fetched reservations must be matched against imported ones, not inserted. Virtual cards of existing bookings come only from each booking site's extranet. The import must carry the old provider's card reference per reservation. Card Guarantee needs a state "transferred, not yet verified" and a kind "virtual card at booking site".

## Answer

Resolved 2026-09-30 by grilling, within "Card transfer between providers and re-delivery of existing channel bookings".

- **Card transfer**: offered once our card provider confirms in writing that stored cards can be imported into a hotel's account on our platform. Then the onboarding plan starts the transfer about two months before the switching day, with a cut-off date; cards stored at the old provider after the cut-off are asked again through the Portal. Card Guarantee gains the state **Transferred, not yet verified**, until the first successful use. If the provider does not confirm, guests store their card again. Obtaining the confirmation is ticketed as "Card provider confirmation of card import".
- **Existing channel bookings**: the import from the old system is the truth. Imported reservations carry the channel booking number. After connecting, we trigger the channel manager's fetch of future bookings for the sites that support it and match by booking number; mismatches are listed for staff; nothing is inserted twice. The first availability push is computed from our imported reservations.
- **Virtual cards of existing bookings**: the reservation shows "virtual card at booking site" with activation date where known. Staff take the card from the site's extranet when charging and key it at the terminal as a mail or phone order. Cards of bookings made after the switch arrive as tokens through the channel manager.
- **Guarantees not secured after the switch** (owner's choice): handled manually by staff. No automatic Portal request and no worklist; the reservation shows the state. The property decides per its policy whether to keep or cancel.
