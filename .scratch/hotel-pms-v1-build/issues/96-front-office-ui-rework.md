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

**Status:** ready-for-agent

- [ ] A Front Desk user with a role at one property sees no property switcher and no other property anywhere in the app
- [ ] A Front Desk user with roles at two properties chooses one after sign-in and sees only that one until they change it
- [ ] A Property Manager still has the switcher and "All properties"
- [ ] A one-room booking from dates to "Book" completes without scrolling the page at 1440 × 900
- [ ] Salutation, address line 2, region and place of birth can be entered and are kept on the guest profile
- [ ] The full guest form opens from the booking screen and the reservation tab without leaving them
- [ ] Country and nationality are picked from a searchable list in both languages
- [ ] Today shows Arrivals, Expected departures, In house and Checked out as buttons; the chosen list stays visible and scrolls inside its box
- [ ] List rows show room, guest name, folio balance and Card Hold (status and amount, once ticket 27 is done)
- [ ] Searching by room number or name and filtering or sorting narrows the list without leaving Today
- [ ] Clicking a row shows the reservation on the right, editable; saving updates the list row
- [ ] Action buttons Abkassieren, Türschließsystem, Reservierung, Folio, Fixed Charge, Company billing and Move room are on the selected reservation; unbuilt ones are disabled with their ticket named
- [ ] A Fixed Charge for parking over three nights posts one Charge per night and follows a shortened stay
