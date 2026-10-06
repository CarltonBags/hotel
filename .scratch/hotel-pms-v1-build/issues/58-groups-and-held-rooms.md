# 58 — Groups, Held Rooms, Tentative and Definite, release and Series

**What to build:** Front Desk or Property Manager creates a Group with contract data, organiser, dates, Held Rooms per room type and night with a Release Date, contract prices per room type and night with included Services, terms as text and reduction rules. Tentative groups do not reduce availability but show demand in the Calendar with a warning when availability falls below it and lapse at their option date; Definite groups take Held Rooms out of availability everywhere including channels. On the release date unsold Held Rooms return to sale and channels update; staff are warned 3 days before and may extend. Series create one dated holding per departure. Revenue edits prices and release dates. Held Rooms of Definite groups count as sold in pace figures.

**Blocked by:** 22 Edit, move and cancel reservations with audit log and forced overbooking, 37 Channex connection and ARI outbox

**Status:** in review (PR stacked on ticket 53)

- [x] Definite group of 10 Doubles lowers availability by 10 and reaches Channex
- [x] Release job returns 4 unsold rooms and updates channels
- [x] Tentative demand above availability shows the warning without blocking
- [x] Series of 8 Saturdays creates 8 holdings with their own release dates

## Comments

**Built.** The Groups page (Groups Module of the subscription; Property Manager, Front Desk, Revenue to view): create a Group with contact, organiser (Company or a person), option date, contract terms and reduction rules as text; it gets its own hidden rate plan for the contract prices. Held Rooms per room type and night in one or more holdings, each with its Release Date (default days before arrival, at least tomorrow); contract prices per room type and night in the holding's grid. Tentative groups leave availability alone; the Calendar shows their demand and warns where it exceeds what is free, and the group page names the shortfall. Definite takes the unsold Held Rooms out of availability in every quote, booking and the channel ARI outbox; going Definite is refused where not enough rooms are free. Booking from the group fills its Held Rooms (the group's own bookings do not lower availability twice). An hourly worker duty releases unsold Held Rooms on the release date (channels updated), warns staff 3 days before, and lapses Tentative groups at their option date; a later release date extends. A Series creates one holding per weekday between two dates, each with its own release date. Revenue edits prices and release dates; Held Rooms of Definite groups count in the pickup report and occupancy.

**Verified.** domain: unsold per night, status changes, shortfall, Series dates, release date default and warning. db: 5 tests (Definite lowers availability and queues ARI, release duty returns unsold rooms, Tentative warning without blocking, Series of 8 Saturdays, Definite refused without free rooms and no Held Room left). Walkthrough 11/11: group of 10 Doubles Tentative then Definite (availability 21 → 11, outbox entry), contract prices, 6 bookings from the group (4 unsold, availability unchanged), a release date of today refused, release duty returns 4, Tentative shortfall warning with the group page naming it, Series of 8 Saturdays with 8 release dates.

**Review fixes.** Every action is checked at the group's own property with the Groups Module on (not the user's current property); the detail page checks view rights and the module; the grid sends only changed cells, Held Rooms under "manage groups" and prices under "edit group contract" so Revenue can save prices; a person organiser is kept on save; going Definite checks free rooms per night and moves passed release dates to tomorrow; release dates must lie ahead; booking from a released holding or with no Held Room of the type left is refused; group rate plans stay out of the rates grid, price ends and go-live checks, with a foreign key to the group; the duty query filters by date in SQL.

**Open points.**
- Release is per holding, not per night or room type.
- Included Services are kept in the terms text, not as posted Services.
- A person as organiser can be kept but not chosen in the form yet (Company only).
- Duty notifications are sent after the transaction; a failure loses that warning until the next hour.
- Pace: Held Rooms count as sold in the pickup report; the Revenue pace figures (ticket 66) should read the same.
- Not asked for: a Cancelled status, the booking form on the group page, the release-days default, notifications for lapsed groups.
