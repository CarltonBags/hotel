# 96 — Front office UI rework: one property, Today workspace, compact booking screen, full guest details

**What to build:** The owner is not satisfied with how the staff app presents itself to the front office. This ticket covers four things.

1. **One property at a time for the front office.** A user whose roles are only front-office roles (Front Desk, Housekeeper, Housekeeping Supervisor, Maintenance) sees only the property they work in now. There is no "All properties", no list of other properties on Today, and no consolidated dashboard. With a role at one property, the navbar shows that property's name with no switcher. With roles at several properties, the user chooses the property after sign-in and changes it from the user menu, not from a navbar switcher. Property Manager, Accounting, Revenue and Owner keep the switcher and "All properties" (decision 01, "Cross-property surfaces").
2. **A booking screen without scrolling.** New reservation fits a laptop screen (1440 × 900) without page scrolling for a one-room booking:
   - The stay bar (dates, persons, Rate Code) stays fixed at the top.
   - Availability is a compact table: room types as rows and Rate Plans as columns, with price and free rooms per cell. One click adds a room.
   - The cart (Booker, rooms with their guest, notes, total, Book) is a fixed side panel next to the table, not a section below it.
   - Picking or creating the guest happens inline in the cart. "More details" opens the full guest form in a side drawer without leaving the booking.
3. **All of a guest's information, where it is needed.** The guest profile already holds name, date of birth, nationality, country of residence, address line, postal code, city, email, phone, language, preferences, VIP, marketing consent and identity document. These gaps are filled:
   - New fields: salutation, address line 2, region or state, and place of birth (Swiss federal minimum, decision 49).
   - The full guest form opens as a side drawer from the booking screen and from the reservation tab, for the Primary Guest and every other guest. The guest profile page uses the same form.
   - Fields the property's registration rules require (Meldeschein, Canton Profile) are marked. Missing ones are listed on the reservation tab before check-in. Enforcing them belongs to the registration tickets.
   - Countries and nationalities are chosen from a searchable list of countries, not typed as codes.

4. **Today becomes the front-office workspace.** For the selected property, Today is one box that fills the screen below the shell and does not scroll as a page:
   - **Left: list buttons.** Arrivals, Expected departures, In house and Checked out (today). The clicked button stays highlighted, and its list shows in a box that is always visible and scrolls on its own. The counts sit on the buttons.
   - **List rows** show room number, guest name, the guest folio balance (0,00 when settled), and the Card Hold: whether one exists and its amount. Every row can be read at a glance without opening it.
   - **Search and filters above the list:** search by room number or guest name; filters (room type, Rate Plan, Booker or Company, VIP, unassigned room, open balance, no Card Hold); sorting by room, name, arrival, departure or balance. The choice stays per list for the session.
   - **Right: the selected reservation.** Clicking a row shows that reservation beside the list, editable in place: stay, persons, room type, guests with their full details (section 3), notes. The list stays where it was.
   - **Action buttons on the selected reservation**, always in the same place:
     - Abkassieren (settle and check out)
     - Türschließsystem (key card or door access)
     - Reservierung (open the full reservation tab)
     - Folio (open the guest's folios)
     - Fixed Charge (add a recurring Charge, defined below)
     - Company billing (add a folio with a Company as Bill-to, routing set at once)
     - Move room
     - Check in, on arrivals
   - **Fixed Charge** (new term for the glossary): a Service the stay carries for a range of nights, for example parking or a dog, posted night by night like the stay Charges. It is set from the workspace and the reservation tab, shown with its nights and price, and follows the stay when the stay is extended or shortened.
   - **Buttons whose feature is not built yet are shown disabled, with the ticket that brings them.** Abkassieren needs payments and check-out (27, 28). The folio balance after payments and the Card Hold column need 27. Türschließsystem needs the Site Bridge and a Lock Plugin (68 and 70–77, gate 07). Each ticket switches its button on when it lands. The layout, list, search, filters, edit panel and the rest of the buttons are built now.
   - **Live updates:** the lists update without reload when reservations change, as Today already does.
   - **Other roles:** users with the switcher keep the per-property cards on Today when "All properties" is selected. With one property selected, they get the same workspace if they have the right to view operational lists.

**Assumption to confirm:** a Front Desk user who also holds a back-office role (for example Accounting) at a property keeps the switcher. The rule above applies only to users with front-office roles alone.

**Blocked by:** None — can start immediately (builds on 12, 20, 21 and 25, all done).

**Status:** done

- [x] A Front Desk user with a role at one property sees no property switcher and no other property anywhere in the app
- [x] A Front Desk user with roles at two properties chooses one after sign-in and sees only that one until they change it
- [x] A Property Manager still has the switcher and "All properties"
- [x] A one-room booking from dates to "Book" completes without scrolling the page at 1440 × 900
- [x] Salutation, address line 2, region and place of birth can be entered and are kept on the guest profile
- [x] The full guest form opens from the booking screen and the reservation tab without leaving them
- [x] Country and nationality are picked from a searchable list in both languages
- [x] Today shows Arrivals, Expected departures, In house and Checked out as buttons; the chosen list stays visible and scrolls inside its box
- [x] List rows show room, guest name, folio balance and Card Hold (status and amount, once ticket 27 is done)
- [x] Searching by room number or name and filtering or sorting narrows the list without leaving Today
- [x] Clicking a row shows the reservation on the right, editable; saving updates the list row
- [x] Action buttons Abkassieren, Türschließsystem, Reservierung, Folio, Fixed Charge, Company billing and Move room are on the selected reservation; unbuilt ones are disabled with their ticket named
- [x] A Fixed Charge for parking over three nights posts one Charge per night and follows a shortened stay

## Comments

**Done (2026-10-02).**

**One property for the front office.** A user whose roles are only Front Desk, Housekeeper, Housekeeping Supervisor or Maintenance works in one property at a time:
- With one property, the navbar shows its name with no switcher.
- With several, a chooser appears after sign-in, and the user menu changes property under "Working at".
- The choice is cleared at sign-in and sign-out, so a shared desk PC does not carry it to the next user.
- Every page and action refuses other properties for these users, not only the shell. A Berlin reservation opened by URL while working at Zürich lands on "not allowed". Guest profiles show stays and "created at" only for the working property.
- Everyone else keeps the switcher and "All properties".

**Today workspace.** With one property selected and the right to see operational lists, Today is the front-office workspace:
- Buttons for Arrivals, Expected departures, In house and Checked out, with counts.
- The list scrolls in its own box. Rows show room, guest, VIP, folio balance on the guest's own folios, and Card Hold.
- Search matches a room number from its start or a name anywhere. Filters are room type, Rate Plan, Booker, VIP, no room and open balance. Sorting is by room, name, arrival, departure or balance. These are kept per list for the session.
- Clicking a row opens the reservation on the right, in tabs: Stay (edit and room assignment), Guest (full details), Folio, Fixed Charges, Company billing, Notes.
- Action buttons: Check in, Abkassieren, Türschließsystem, Reservierung, Folio, Fixleistung, Firmenrechnung, Zimmer umziehen. Abkassieren waits for tickets 27 and 28, and Türschließsystem for 68 and 70–77. Both are disabled with a hint naming the ticket.
- Lists update live, including after notes, Charges and Fixed Charges change.

**Fixed Charges** (new glossary term, "Fixleistung" proposed in German):
- A Service for a range of nights, posted night by night: at check-in, or at once for a guest in house.
- A range that ran to an end of the stay follows the stay; the rest is clipped to it.
- The early-departure fee leaves them out.
- Removing one voids its nights from today on.

**Company billing** adds a folio billed to the Company and moves the Company's default Routing Rules to it at once.

**Booking screen.** The stay bar sits on top. Availability is a table, with room types as rows and Rate Plans as columns. The cart is a side panel with the Book button always visible. A one-room booking needs no page scrolling at 1440 × 900. The guest box searches, or creates a guest from "Last, First".

**Guest details.**
- New fields: salutation, place of birth, address line 2, region.
- Country and nationality come from a searchable list of the 249 ISO countries, named in the user's language.
- The full form opens in a side drawer from the booking screen and the reservation tab, and inline in the workspace.
- Fields the property's registration needs are marked, and the missing ones are listed.

**Verified:** 254 tests green (domain 101, db 107, auth 17, events 5, staff 10, worker 14), plus typecheck, lint and the tenant SQL lint. Browser walkthrough 30/30:
- The workspace lists, search and filters, selection, and the action buttons.
- A Fixed Charge posted night by night, and company billing.
- Guest details through the country picker until registration is complete. Notes.
- A one-room booking without page scroll, with the guest drawer on the booking screen and on the reservation tab.
- Two invited Front Desk users: one property with no switcher; two properties with the chooser, the user-menu change, and refusal at the other property.
- The owner keeps the switcher.

**Review fixes applied:**
- The workspace remounts per reservation, so no typed values carry over.
- Notes are shown only with the contact-data right.
- A Fixed Charge left without nights is removed before the stay update.
- A night already slept is never charged twice.
- German "Kartenvorautorisierung" is used for Card Hold.
- The reservation tab uses the drawer.
- Live updates after notes and Charges.
- Move room scrolls to the room assignment.
- Duplicated helpers were merged.

**Open points:**
- Registration fields are the statutory minimum per country (DE, AT, CH) until the registration tickets bring each property's rules, such as the Swiss Canton Profile.
- German terms "Fixleistung" and the earlier "Logis-Leistung" need the owner's confirmation in the glossary.
- The Card Hold column, the "no card preauthorisation" filter and balances after payments arrive with ticket 27. The Checked out list fills with check-out in ticket 28.
- Service and spa staff roles are treated like back-office roles for property scope, since the ticket names only the four front-office roles. Outlet tickets may revisit this.
