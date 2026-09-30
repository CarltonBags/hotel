# Rates and restrictions model

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 02 03

## Question

Define Rate Plan, Rate, Restriction and their relation to room types and availability. Decide: base vs derived rate plans, per-date pricing, occupancy-based pricing, restrictions (min/max stay, closed to arrival/departure, stop sell), packages and extras, how rates map onto the chosen channel manager's model, and who edits rates from which screen. Resolve the terms into CONTEXT.md.

Requirements handed over by "Booking engine flow": each Rate Plan needs a Payment Policy (pay in full, deposit as percentage or first night, card guarantee, no card), a Cancellation Policy (free until when, fee after), a flag whether date changes are allowed, public or hidden behind a Rate Code (a corporate code may attach a Company), bookable online or not, included Services, and texts per language. Requirements from "Channel manager selection" are in that ticket's answer.

## Answer

Resolved 2026-09-28 by grilling.

**Structure**
- A **Rate Plan** belongs to a property and spans one or more room types. Policies, included Services and texts are written once per plan.
- A **Rate** is the price for one rate plan, one room type and one date, gross, in the property currency, for the room at its **Base Occupancy**.
- Towards the channel manager each (rate plan, room type) pair is projected as one external rate plan; the mapping is kept automatically.
- Availability stays one number per room type and date. **No availability limit per rate plan in v1.**

**Base and derived**
- A **Base Rate Plan** holds its Rates directly.
- A **Derived Rate Plan** is a base plan plus or minus an amount or a percentage, with a choice per restriction whether it inherits from the base. One level only: a derived plan is never the parent of another.
- The system always stores the resulting daily values of derived plans, so every channel manager receives absolute prices.

**Occupancy pricing**: base price plus **Supplements** defined on the rate plan: single-occupancy reduction, extra adult, child per **Age Band**. Age bands are set per property (for example 0 to 2 free, 3 to 11 child, 12 and over adult). Per-occupancy prices for channels are computed from these.

**Price entry**: a daily grid, no season object. Bulk edit by date range, weekdays and room types, setting a value or adjusting by amount or percentage. Prices are kept at least 500 days ahead; the system warns when the horizon runs short.

**Restrictions**, per rate plan, room type and date: stop sell, closed to arrival, closed to departure, minimum stay on arrival, **minimum stay through**, maximum stay. Minimum stay through is sent where the channel manager supports it and falls back to the arrival-based rule elsewhere. Shortcuts "close room type" and "close property" write stop sell into all rate plans for the chosen dates.

**Packages**: a rate plan lists its included Services, each with a fixed component price per person-night; the room receives the remainder. The guest sees one price; charges are posted per component with their own Tax Code. The **Meal Plan** (none, breakfast, half board, full board) is an attribute of the rate plan.

**Policies on the rate plan**
- **Payment Policy**: pay in full, deposit (percentage or first night), Card Guarantee, or no card.
- **Cancellation Policy**: free until N days before arrival at a set property time, or never free; fee after the deadline is first night, a percentage of the stay, or the full stay; separate no-show fee. Policies are reusable objects per property. Stepped schedules are not in v1.
- Date changes allowed or not; early-departure fee.
- Public, or hidden behind a Rate Code (a code may attach a Company).
- Bookable online or not; sold on channels or not.
- Name, description and policy text per language.

**Reservations keep their prices**: each reservation stores its price per night at booking. Later rate changes never alter it. A date change or extension prices only the added nights at current rates.

**Price Override**: Front Desk may change a night's price on a reservation with a mandatory reason. Revenue sets a **Price Floor** per room type; going below it needs the Property Manager. Complimentary is its own action with a reason. All logged.

**Editing**: Revenue and Property Manager edit in the Rates grid (rows rate plan by room type, columns dates, cells price plus restriction marks). The Calendar shows availability and lowest price per room type per day, read-only. Front Desk sees rates when creating reservations. Every change is logged with user, old and new value, and queued for the channel manager.

**Limits to respect**: at most 20 room types and 200 projected rate plans per property at the chosen channel manager; rate plan occupancy never above room type occupancy.

- ADR: `docs/adr/0012-rate-plan-spans-room-types.md`.

> Update 2026-09-29: without a booking page, "public or hidden behind a Rate Code" and "bookable online" apply to what is sent to channels and offered by staff. A corporate code attaching a Company is used by staff when booking.
