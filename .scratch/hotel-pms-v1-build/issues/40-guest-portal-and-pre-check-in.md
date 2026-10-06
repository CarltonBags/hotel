# 40 — Guest Portal with Portal Link and Pre-check-in

**What to build:** The guest opens a per-reservation Portal Link (signed, valid from confirmation to 30 days after checkout, revocable by staff) from the confirmation email, or uses confirmation number plus last name with a one-time code by email; the Booker gets a booking-level link listing every reservation with invitations per room. In the cinematic guest look the guest completes Pre-check-in: own and companion details, address, arrival time, identity document fields (image upload as per-property opt-in), Country of Residence, Messaging Consent, adds extras from the catalogue until arrival, downloads invoices, and reads the hotel's info. Guests cannot change dates or cancel. No tracking cookies. Data written back to the Guest profile and logged as entered by the guest.

**Blocked by:** 39 Email delivery, templates, automatic messages and staff alerts

**Status:** in review (PR stacked on ticket 38)

- [x] Link after expiry or revocation shows a neutral page
- [x] Pre-check-in data appears on the reservation and Guest profile marked as guest-entered
- [x] Booking-level link shows all reservations and invites a room guest by email
- [x] Portal in German and English at least, following the guest language

## Comments

**Built**
- **Portal Links:** a random key per reservation, and one per booking for the Booker. A link opens until 30 days after departure (for a booking, the last stay not cancelled). Staff revoke either link by giving it a new key; the old link shows a neutral page.
- **Who gets which link:** guest messages carry the stay's link. A Booker who is the guest of a booking with several rooms gets the booking's link, which lists every room.
- **Without the link:** booking number and last name, then a one-time code by email.
  - A room's guest gets their stay; the Booker of several rooms gets the booking.
  - The same answer whether or not anything matched.
  - Five codes an hour per stay. Five tries per code, counted in one database statement, so parallel guesses cannot pass the limit. Ten minutes valid.
  - The code goes into the mail only when it is sent; the record never keeps it, and is cleared on failure too.
- **Pre-check-in** in the cinematic guest look, on the property's own photo where it set one:
  - own and companions' details (up to 10 companions), address, arrival time, identity document fields, Country of Residence;
  - Messaging Consent, recorded with time, source and our own wording when it changes;
  - a document picture where the property allows it and keeps registration records (DE, AT). It is kept as long as a registration form, at most 5 per stay, and checked before anything is stored.
  - Written to the Guest profile and logged as entered by the guest. An empty field never blanks stored data.
- **Extras:** Services bookable online, until the arrival day, as Charges on the arrival date.
- **Invoices:** the stay's own (the Booker: all rooms') to download.
- **Hotel information** per language; no date changes or cancellation; German and English following the guest's or the Booker's language, else the browser's; no cookies; no referrer.
- **Booking link (for the Booker):** lists the rooms without any guest's personal data or room link, and invites a room's guest.
  - A guest known with an address gets it at that address.
  - A room in the Booker's own name, or a guest without an address, gets a profile of their own with the address given, so the invited person never sees or overwrites the Booker's data.
  - Three invitations a day per room.
- **Staff side:**
  - the reservation shows both links, Pre-check-in, arrival time, companions, consent and document pictures, and revokes either link;
  - settings for the portal's texts, its photo and document pictures;
  - the guest history labels portal and channel entries.

**Verified**
- Domain: link window, last names, extras window, arrival time, language.
- DB tests:
  - the stay and the booking open; unknown keys do not;
  - Pre-check-in to the profile as entered by the guest; empty fields keep data; consent once;
  - extras as charges; revoked and expired links;
  - invitation with the room's link;
  - the Booker's room gets its own profile, and the booking view carries no room guest's data; three invitations a day;
  - the Booker's link revoked;
  - 30 parallel guesses stop at five tries;
  - the Booker's code opens the booking, and the code is not kept;
  - the pre-arrival message carries the link.
- All packages typecheck and pass.
- Walkthrough (first run 16/17; the one failure was the script's document count on a reused stay):
  - settings with photo; the stay opens without sign-in or cookies;
  - photo behind the card; hotel info;
  - Pre-check-in and document picture; an extra;
  - the staff panel with the picture by signed link;
  - the code fallback; revoked link neutral;
  - the booking link with an invitation giving the room its own profile.

**Review fixes**
- **Code limit:** five tries could be passed with parallel guesses; tries are now counted atomically. The per-process limiter (which trusted a client header) is gone; the limits are in the database.
- **Booking link:** could not be revoked; now it can.
- **Booker exposure:** the Booker saw room guests' emails and could get a room's link for any address. The booking view now carries none, and invitations go to a known guest's own address. A room in the Booker's name gets a new profile, so an invited colleague never sees or overwrites the Booker's data.
- **Spam:** invitations are limited to three a day per room.
- **Blanked data:** Pre-check-in could blank stored data (dates, document type); empty fields now keep it.
- **Code storage:** a stored code is cleared on failure as well.
- **Companions:** the limit is now 10 everywhere.
- **Consent wording:** came from the form; it is now ours, recorded only on change.
- **Document pictures:** only where registration records are kept, checked before storing, at most five.
- **Booker's link:** a Booker who is not a room's guest had no way in. They now get the booking link in their messages and by code.
- **Language:** follows the Booker and the browser.
- **Photo:** the property's own photo behind the portal.
- **Messages:** with no portal address, messages with a link wait instead of being suppressed for good.
- **Cleanup:** one helper for the portal's address; constants for the history labels.

**Open points**
- **Code mail to the Booker:** a code asked for by the Booker is written in the room's language and with the room guest's greeting.
- **Swiss document pictures:** need the Canton Profile (ticket 49).
- **Germans at a German property:** their pictures are kept like other guests' for a year, though a Meldeschein is no longer needed for them.
- **Payments and express checkout:** ticket 41. Messages and the inbox: tickets 42/43.
