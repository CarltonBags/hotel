# Guest portal identity model

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

How does a guest access the guest portal? Options: per-reservation magic link with no account, full guest accounts with login and cross-stay history, or a hybrid. Decide what the portal must do at minimum (pre-check-in form, ID capture, balance payment, messaging, self check-out), how a guest with several reservations across properties of one tenant is handled, and what identity data the PMS may store. Resolve Guest, Booker and Portal Session terms into CONTEXT.md.

## Answer

Resolved 2026-09-24 by grilling.

- **No guest accounts in v1.** Access is a per-reservation **Portal Link**: a signed magic link sent with the confirmation by email (SMS optional), valid from confirmation until 30 days after checkout, revocable by staff. Fallback: confirmation number + last name, then a one-time code by email/SMS. Guest profile and portal access stay separate concepts.
- **Who gets a link**: the Primary Guest of each reservation (the Booker if no guest email exists yet); companions' data is entered in that same session. The Booker gets a **booking-level** link that shows every reservation in the booking, lets them invite each room's guest and pay for all.
- **Capabilities**: pre-arrival registration (guest and companion details, address, arrival time, Meldeschein data for foreign guests); ID document as typed fields only (type, number, nationality, expiry), document image upload is a per-property opt-in with retention tied to Meldeschein retention; pay deposit or balance and store a card for incidentals via Stripe with SCA; messaging; online pre-check-in; express checkout with invoice download.
- **Online pre-check-in is always staff-approved**: the guest completes registration and payment online, the front desk confirms and assigns the room; the reservation becomes Checked-in only by staff action. The lobby kiosk flow decides its own completion rule in "Self check-in guest interface".
- **Messaging**: an in-portal thread per reservation. The guest is notified by email on each new message. The hotel side is a WhatsApp-style **Guest Inbox** in the staff app: conversation list with unread badges, always visible, answered per property. WhatsApp/SMS as transport is fog.
- **Digital key / door-lock control is a per-property opt-in, never default**; hotels keep control because a guest may check in online and never arrive while holding a key. Integration vendors are fog.
- ADR: `docs/adr/0005-no-guest-accounts.md`.

> Update 2026-09-28: "Self check-in guest interface" refines the staff-approval rule. Remote pre-check-in still never checks a guest in; a guest on site may complete Self Check-in without staff when the Check-in Conditions hold.

> Update 2026-09-29 from "Notifications model": in v1 the Portal Link and the one-time code are sent by email only. SMS to guests is not in v1.

> Update 2026-09-29: the Guest Portal stays after the booking page was removed. It serves existing bookings: Pre-check-in, payment, card storage, messages, invoice download, adding extras until arrival. Guests cannot change dates or cancel there; they contact the hotel or the site they booked through.

> Update 2026-09-30: the Guest Portal gains spa self-booking within slots the spa releases, charged to the room.
