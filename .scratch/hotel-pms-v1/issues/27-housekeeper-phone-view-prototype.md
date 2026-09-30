# Housekeeper and maintenance phone view prototype

Map: ../map.md
Type: prototype
Status: resolved
Blocked by: -

## Question

What does the phone-first view for Housekeeper and Maintenance look like? Prototype on a phone frame: my tasks today (order, grouping by Section, priority flags), the room card (status change in one tap, guest declined, minibar items, lost and found, report issue with photo), how a task updated during the day appears, the Maintenance queue and issue detail, and the supervisor's assignment board on desktop (proposed distribution, drag between staff, publish, inspect). Decide language handling for staff who do not read the hotel's main language (icons first, selectable language per user) and behaviour with poor Wi-Fi on the floors.

## Answer

Resolved 2026-09-29 by prototype; verdict given by the product owner in the browser.

**Housekeeper's overview: variant A, "List by section".** All of the user's rooms for the day, grouped by Section, priority rooms first inside each group. Each row: coloured icon for the task type, room number large, task type and minutes, guest surname, flags (guest waiting, VIP, changed, waiting to send), state mark. The housekeeper chooses her own order. The header shows rooms done of total and minutes left. Variants B (one room at a time) and C (tile board) were not chosen.

**Room sheet**, opened by tapping a room, slides up from the bottom:
- room number, task type, minutes, Floor View of the guest;
- Start and Done as the two largest buttons; Done sets the room to Clean in one tap; Undo afterwards;
- Guest declined and Do not disturb, for stayover and linen tasks only;
- Minibar: counters per item, posted as Charges;
- Report problem and Lost and found: photo first, then one tap on a quick pick.

**Changes during the day**: a task changed by front desk or supervisor (early departure, room move, reassignment) is marked "Changed" on the phone and moves to the top of its Section.

**Supervisor**
- Desktop board: one column per housekeeper plus Unassigned, rooms as chips that are dragged between columns, minutes per person against the shift length, rooms with a waiting guest outlined.
- The morning proposal is a draft until **Publish**. After publishing, every move reaches the affected phones at once with the "Changed" mark. A task already started cannot be moved away without confirmation.
- Inspection on both surfaces: the supervisor's phone on the floor and the desktop board show the rooms set to Clean. Inspected in one tap, or back to Dirty with reason and photo, which returns the room to the housekeeper's list.

**Maintenance**: queue sorted by urgency, with place, description, reporter and any Room Block. "I take it" and "Fixed". Fixing may add photo and note; the reporter is notified. Fixing an issue that carries a Room Block asks whether to end the block; the room then becomes Dirty and enters housekeeping.

**Housekeeping notes**: front desk picks from a fixed property list with icons (feather allergy, baby cot, extra bed, welcome gift, late checkout, pet, accessibility need), shown in the phone's language. Free text remains possible and is shown as written. Found while prototyping: free text does not follow the phone's language.

**Languages**: a setting per user. Shipped for the phone view at launch: German, English, Polish, Romanian, Bulgarian, Croatian/Serbian/Bosnian, Hungarian, Turkish, Ukrainian, Arabic. Icons and colours always accompany words. Arabic requires right-to-left layout.

**Poor Wi-Fi**: the phone view works offline for the day's tasks. The tasks are stored on the phone when the plan is published. Status changes, minibar, declined, and problem reports with photos are saved locally, marked "waiting to send", and sent when the connection returns. If the supervisor changed the same task in the meantime, the supervisor's newer change wins and the housekeeper is told. The view is installable as an icon on the home screen.

Assets:
- Screenshots: `docs/design/housekeeping/`.
- Prototype: `apps/staff-shell-prototype`, route `/prototype/housekeeping?variant=A|B|C`, params `lang=en|de|pl`, `role=maintenance`, `offline=1`, `early=1`, `sheet=<task id>`, `theme=dark`. Code in `components/prototype/housekeeping/`. Uncommitted.
- Not prototyped: Publish as a draft step, inspection on the supervisor's phone, ending a Room Block from the maintenance queue, the fixed notes list, real offline storage. These are decided above but untested in the browser.
