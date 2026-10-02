# 26 — Check-in with folio posting, Charges and Routing Rules

**What to build:** Front Desk checks a reservation in from the arrivals list or its tab (room assigned): all nights are posted at once as one Charge per night per component with its Service Date (ADR 0009), gross with Tax Code (ADR 0010), packages split into components. A Reservation has one Folio created automatically with a Bill-to, staff add more; Routing Rules per reservation (defaults from the Company) decide where Charges land; staff move uninvoiced Charges between Folios and void them with a mandatory reason, kept in the audit log. Property Manager may post free-text Charges; anyone with the right posts from the Service catalogue. Shortening a stay proposes voiding future Charges plus an early-departure fee; extending posts the added nights; room-type change voids and reposts future nights. The folio tab shows Charges, totals per Tax Code and balance.

**Blocked by:** 22 Edit, move and cancel reservations with audit log and forced overbooking, 25 Today dashboard, operational lists and cross-property search

**Status:** done

- [x] Check-in of a 3-night package posts 6 Charges (room and breakfast per night) with the right Service Dates and Tax Codes
- [x] Moving a Charge to a second Folio with a Company Bill-to shows net plus VAT there
- [x] Void needs a reason and leaves the Charge visible in the log
- [x] Shortening proposes the voids and posts the fee only after confirmation

## Comments

**Done (2026-10-02).** A booking opens the reservation's folios: folio 1 bills the Primary Guest; with a Company on the booking (Booker or the Company of its Rate Code), folio 2 bills that Company and carries the Company's default Routing Rules. Check-in (right `check_in`, from the arrivals list of today or the reservation tab) needs the arrival date reached and a room for tonight. It posts every night per component: the room part as the Rate Plan's Accommodation Service (new Rate Plan setting, a derived plan falls back to its base plan), included Services per person under the "package" category. Each Charge stores gross, its Tax Code and the rate in force on its Service Date. Charges land on the folio the Routing Rule for their category picks.

The folio section shows Charges with Service Date and Tax Code, totals per Tax Code and the balance. A Company folio also shows net per Charge and net plus VAT per Tax Code. Staff can do the following:
- Post from the Service catalogue (`post_charges`).
- Post a free-text Charge with a Tax Code of the property's Legal Entity (Property Manager, `post_free_text_charges`).
- Move a Charge between folios, void it with a mandatory reason (it stays visible, struck out), add folios with another Bill-to, and set Routing Rules (`manage_folios`).
- See every post, void and move in the Charge log.

After check-in, stay Charges follow the stay. Nights already slept keep their price and Charges. Extending posts the added nights at once. Shortening first shows the Charges to be voided and the Rate Plan's early-departure fee, and applies them only on confirmation. A move from a night on into a room of another room type changes the type from that night, reprices those nights, and voids and reposts their Charges. A night component voided by hand stays settled and is not posted again.

**Verified:** 239 tests green (domain 91, db 102, auth 17, events 5, staff 10, worker 14), plus typecheck, lint and the tenant SQL lint. Browser walkthrough 19/19 covered these steps:
- Set the Accommodation Service.
- Check-in refused without a room.
- Folios open at booking.
- Check-in posts 6 Charges: rooms on Acme's folio under ACC, breakfasts on the guest's under FOOD.
- A moved breakfast shows €22.43 net and €1.57 VAT on the Company folio.
- Void needs a reason and stays visible in the log.
- Shortening shows the voids and a €120 fee, and posts nothing before confirmation.
- An in-house move to OBK reposts tomorrow at the new price.

**Review fixes applied:**
- The room-type change in house is implemented as described above.
- Folios open at booking.
- Nights already slept are never repriced.
- Automatic voids are marked in a column of their own, not recognised by their reason text, and are shown in the user's language.
- A night voided by hand is not posted again.
- A reservation with open Charges cannot be cancelled until they are voided.
- A Calendar drop refuses checked-in stays: change those on the reservation tab, where a shortening can be confirmed.
- Voids and moves are checked against the reservation the user is authorised on.
- The column was renamed from "room service" to Accommodation Service.
- The German UI uses "Storno" as the glossary says.

**Open points:**
- The early-departure fee is charged under the Accommodation Service's Tax Code until the tax advisor answers (gate 03; TODO in code). It is computed on the given-up nights' full price, package included.
- German term "Logis-Leistung" for Accommodation Service is a proposal in the glossary file and needs the owner's confirmation.
- Charge descriptions are stored in the language they were posted in (the Service name). Invoices (ticket 28) decide the language on the invoice.
- The property's wall-clock date stands in for the Business Date until Night Audit (TODOs in code).
- Reservations booked before this ticket get their folios with their first Charge or at check-in.
- Payments and the balance after payments come with ticket 27, City Tax with its own ticket.

**Follow-up (2026-10-02, owner):** Arrivals list only guests still to arrive (Confirmed). A checked-in guest leaves the list and Today's arrivals count, and is found under In house. The arrivals list no longer has a status column.
