# Groups and allotments

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

Define group business on top of Booking, Reservation and Folio. Decide: what a Group is (one Booking with many Reservations, or its own object), held rooms for a group or tour operator with a release date after which unsold rooms return to sale, rooming lists (import, late names), group rates outside the public Rate Plans, the master folio and routing of charges between master and individual folios, deposits and cancellation terms per group contract, group check-in, registration for groups above ten persons through the tour leader, and how held rooms affect availability sent to channels. Resolve the terms into CONTEXT.md.

## Answer

Resolved 2026-09-29 by grilling.

**Group**: its own object holding the contract: name, organiser (a Company or a person), dates, **Held Rooms**, prices, terms, Master Folio. Every room booked for the group is a normal Reservation linked to the Group. Front desk works with reservations as always.

**Held Rooms**: a number of rooms per room type and night reserved for a Group before names are known, with a release date.

**Two states of a Group**
- **Tentative**: an offer is out. Held Rooms do not reduce availability; they appear in the Calendar as wanted by the group. Has an option date after which it lapses. When availability on a night falls below the tentative demand, the Calendar and the Group show a warning and staff decide: make it Definite, reduce its rooms, or let it lapse. Nothing is blocked automatically.
- **Definite**: the contract is signed. Held Rooms are taken out of availability everywhere, including the booking engine and channels.
This applies to Groups only. Single reservations stay without a Tentative state, and rate plans stay without an availability limit.

**Release**: on the release date, Held Rooms without a reservation return to sale automatically and the channels are updated. Staff are warned beforehand, default 3 days, and may extend the release date before it passes. Release is per group, optionally per night.

**Series**: a Group may be a series for tour operators: one contract, an arrival pattern between two dates (for example every Saturday, 7 nights, 10 Doubles). The system creates one dated holding per departure, each with its own release date and rooming list.

**Prices**: entered in the contract per room type and night, with included Services. Reservations made from the group take that price. Optionally the group has a Rate Code: its guests book themselves in the booking engine at the group price, drawing from the Held Rooms until release.

**Master Folio**: a Folio on the Group, billed to the organiser. Group-level Routing Rules decide per Service where charges land, for example room, breakfast and City Tax on the Master Folio and extras on each guest's own folio. Individual reservations may deviate. The Master Folio produces one invoice listing rooms and nights.

**Terms**: the contract holds a deposit schedule (instalments with due dates; the system issues Deposit Invoices and reminds), the allowed reduction of rooms without fee until a date, and the cancellation steps as text. When the group shrinks or cancels, the system shows what the contract says and staff post the fee. No automatic fee calculation in v1.

**Rooming list**: Held Rooms become reservations with placeholder names, at once or when names arrive. The organiser's list is imported from a spreadsheet template (name, room type, sharing with, arrival, departure, notes) with a preview of mismatches against the Held Rooms, or filled in by the organiser through a link. Names may change until check-in.

**Arrival**: a group check-in screen shows all reservations of the arrival; rooms are assigned in bulk, keeping the group together by floor or Section; key cards are prepared ahead; selected or all reservations are checked in at once. Registration follows the country rules; in Germany the tour leader of a group above ten persons registers for all foreign members with count and nationalities.

**Roles**: no new role. Front Desk and Property Manager create and edit Groups, rooming lists and arrivals. Revenue sees all Groups, edits contract prices and release dates. Accounting handles deposits and Master Folio invoices.

**Reports**: Held Rooms of Definite groups count as sold in pace figures and are shown separately from picked-up rooms.

> Update 2026-09-29: without a booking page, group guests cannot book themselves with a Rate Code. Rooming lists come from the organiser (import or link) or are entered by staff.
