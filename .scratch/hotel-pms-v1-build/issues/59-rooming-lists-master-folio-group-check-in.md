# 59 — Rooming lists, Master Folio, deposit schedule and group check-in

**What to build:** Held Rooms become Reservations with placeholder names at once or when names arrive; the organiser's rooming list is imported from the spreadsheet template with a mismatch preview or filled in through an organiser link; names change until check-in. The Group has a Master Folio billed to the organiser with group Routing Rules per Service (individual reservations may deviate) producing one invoice listing rooms and nights; a deposit schedule issues Deposit Invoices and reminders; on shrink or cancel the system shows the contract text and staff post the fee. The group check-in screen lists all reservations of the arrival, assigns rooms in bulk keeping the group together by floor or Section, and checks in selected or all at once; in Germany the tour leader of a group above ten persons registers for all foreign members by count and nationality.

**Blocked by:** 58 Groups, Held Rooms, Tentative and Definite, release and Series, 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** in review (PR stacked on ticket 58)

- [x] Rooming list import flags a room type not held and a name over the held count
- [x] Room, breakfast and City Tax land on the Master Folio, extras on guest folios
- [x] Bulk assignment keeps the group on one floor when possible
- [x] Group check-in of 20 reservations posts every folio correctly

## Comments

**Built.** Held Rooms become reservations at once under placeholder names (one guest profile each), or one by one from the group. The Rooming List comes from our template (CSV, opens in Excel; German or English headers, semicolon or comma) with a preview flagging a room type the group does not hold, a name beyond the Held Rooms still unnamed, and a row without a last name; the rows without problems name the placeholder reservations (persons per room repriced) or book new ones while Held Rooms are left. The organiser fills in names through a link without sign-in, open until the group's last departure; names change until check-in, staff rename on the arrival screen. The group's Routing Rules (by category: room, package such as breakfast, extras, City Tax) send its reservations' Charges to the Master Folio billed to the organiser; a reservation may deviate on its own folio, and its folio panel shows its part of the Master Folio. The Master Folio becomes one invoice whose lines name room and guest per night range, deposits netted; the organiser's bank transfers are recorded on it, before an arrival with a Deposit Invoice taxed like the group's stays (the Held Rooms at contract prices while no reservation exists). A deposit schedule per group; an installment still open after its date is reminded once, to the organiser by mail and to staff. On a shrink the grid points to the contract; the contract text is shown on the group page and the fee is posted on the Master Folio. The group check-in screen lists the arrival's reservations, assigns rooms together by floor or Section (the floor taking most of the group first), and checks in selected or all, each on its own; in Germany, above ten persons, the tour leader's registration with the members per nationality is recorded and marked signed.

**Verified.** domain: 9 tests (template parsing, mismatch flags, rooms together by floor and Section, deposit schedule, tour leader rule). db: 7 tests (20 placeholders, rooming list with a room type not held and a name over the held count, organiser link, all 20 on one floor, 20 checked in with room, breakfast and City Tax on the Master Folio and extras on the guest folio, one invoice of 60 lines per room and Service, deposit before reservations with its Deposit Invoice, reminder once with mail, contract fee). Walkthrough 15/15 in the staff app and the organiser's page.

**Review fixes.** A deposit is accepted before any reservation (taxed by Held Rooms at contract prices) and decided against the Business Date and the next arrival (Series); the organiser's link closes after the last departure and with the Groups Module off; renames reuse a profile only that stay uses (no profile per rename); placeholders made one at a time per holding; no deposit reminders in Test Mode; a failing deposit look no longer swallows the release notices; the contract text shows to everyone on the group page; "Revier" for Section; smaller clean-ups.

**Open points.**
- Template columns "sharing with", per-row arrival/departure and notes are not read yet; Excel files must be saved as CSV (no spreadsheet library).
- Routing Rules are per category, not per Service: breakfast sold separately follows "extras".
- Deposit Invoices are issued when money arrives (German Anzahlungsrechnung), not per installment; no reminder before a due date.
- Group payments are bank transfers only.
- The organiser's link has no rotation or rate limit yet; anyone with it can rename until the last departure.
- The tour leader's registration does not check member counts against the persons of the arrival; no printed form yet.
- A rooming import that fails midway keeps the lines before it (the message says so).
- Not asked for: leader's birth date and address on the registration, repricing from the list's adults, the "no last name" flag.
