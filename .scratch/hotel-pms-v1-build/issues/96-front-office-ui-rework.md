# 96 — Front office UI rework: one property, compact booking screen, full guest details

**What to build:** The owner is not satisfied with how the staff app presents itself to the front office. This ticket fixes three things.

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
