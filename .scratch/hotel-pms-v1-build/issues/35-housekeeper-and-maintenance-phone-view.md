# 35 — Housekeeper and Maintenance phone view, offline and ten languages

**What to build:** On an enrolled phone, a Housekeeper sees the list by Section from the prototype: rows with task icon, large room number, minutes, surname, flags, state; the room sheet with Start and Done (Done sets Clean, Undo afterwards), guest declined and do not disturb, minibar counters posted as Charges from the catalogue, report problem and lost and found with photo first. Housekeeping Notes from the property's fixed icon list shown in the phone's language. Maintenance sees its queue with "I take it" and "Fixed". Languages per user: German, English, Polish, Romanian, Bulgarian, Croatian/Serbian/Bosnian, Hungarian, Turkish, Ukrainian, Arabic with right-to-left layout. Offline: tasks stored on the phone at Publish, changes and photos queued as "waiting to send", supervisor's newer change wins with a notice; installable on the home screen; stored data encrypted and wiped on revoke.

**Blocked by:** 34 Housekeeping Tasks, Sections and the supervisor board, 14 Devices and PIN Sign-in

**Status:** in review (pull request on branch ticket-35-housekeeper-phone, stacked on ticket-14-devices-pin)

- [x] Matches docs/design/housekeeping variant A
- [x] Airplane mode: Done, minibar and a problem report with photo queue and send after reconnect under the right user
- [x] Conflict with a supervisor change resolves supervisor-wins and tells the housekeeper
- [x] Arabic renders right-to-left; all ten languages load

## Comments

**Built (2026-10-04).**

**Phone View** (variant A, "List by section"). After PIN Sign-in a floor user lands on their rooms of the published plan:
- **List:** rooms grouped by Section, priority and Changed first. Each row has a coloured task icon, a large room number, task and minutes, surname, and flags (guest waiting, VIP, Changed, waiting to send, state). The header shows done of total and minutes left.
- **Room sheet:**
  - The Floor View of the guest and the Housekeeping Notes, each with its icon.
  - Start and Done (Done sets Clean), then Undo.
  - Guest declined and Do not disturb, for stayover and linen tasks.
  - Minibar counters for catalogue Services marked as minibar items, posted as Charges to the guest checked in to the room.
  - Report problem and Lost and found: the photo comes first (or deliberately without one), then a quick pick, the urgency for problems, and an optional note.
- **Maintenance** sees the open problems by urgency, with any Room Block and the reporter, and has "I take it" and "Fixed". The full workflow (notifying the reporter, ending a block) comes with ticket 36.
- **Supervisors** see every room and have a link to the board.

**Offline.**
- The page carries no data. The app fetches its day and keeps it in IndexedDB, encrypted (AES-GCM with a non-extractable key). That protects data at rest, not from someone using the app in the same browser. A revoked Device wipes it.
- Every change is kept on the phone first, shown at once as "waiting to send", and sent when there is a connection, ten at a time, retried every few seconds.
- Each change is applied once, however often it is sent.
- On an enrolled Device the phone keeps a key per user (valid one day, only while the user may sign in on that Device). Changes made offline are therefore sent under the right user even after someone else signed in or the Device locked.
- **Supervisor wins:**
  - A task's version goes up with every change to its work made by anyone other than its own housekeeper on the phone.
  - An offline change against an older version is not applied, and the housekeeper sees a notice naming the room.
  - A guest now waiting (priority) does not count as a change to the work.
- The app can be installed on the home screen: a manifest, plus a service worker that keeps the data-free page and the built assets.

**Languages.**
- Ten languages per user, chosen in the Phone View: German, English, Polish, Romanian, Bulgarian, Croatian/Serbian/Bosnian, Hungarian, Turkish, Ukrainian and Arabic.
- Arabic is laid out right to left. Icons always go with the words.

**Desktop.**
- Housekeeping Notes on the reservation: the fixed list or free text.
- A minibar checkbox on catalogue Services.
- Lost and Found under Housekeeping: kept, returned or disposed, with the photo. The Main Menu placeholder named ticket 35 for it.

**Verified:**
- 380 tests green (db 177, staff 12), plus typecheck and the tenant SQL lint.
- Browser walkthrough 9/9 on a phone viewport:
  - PIN Sign-in lands on the Phone View, and the list shows the user's rooms.
  - In airplane mode, Done, minibar and a problem with a photo waited, then arrived under the housekeeper after reconnecting.
  - A supervisor's change won with a notice.
  - Arabic renders right to left, and Lost and Found opens.
- The ticket 14 walkthrough still passes 12/12.

**Review fixes applied:**
- Removed from the page the data and the change key that the service worker cached in plain text.
- Fixed outbox writes that overwrote each other, and lost queues on large batches or a 400.
- A supervisor's step from the phone now wins.
- A guest waiting no longer turns a housekeeper's Done into a conflict.
- Note icons added; photo first; Undo returns to open when the task was never started.
- Limits on request size and photo size; one failing change no longer blocks the rest.
- The change key is checked against the Device's users.
- Glossary: Phone View added.

**Open points:**
- **Translations:** the eight languages other than German and English are machine-quality and need a native speaker's review.
- **Photos:** kept in the database until tenant file storage (ticket 36) moves them.
- **"Stored on the phone at Publish":** the phone stores the day whenever the Phone View is open and online (it refreshes every 30 seconds). A phone never opened after Publish has nothing offline; true push needs web push, which is not built.
- **Minibar after check-out:** counted in a departure room after the guest checked out, it is refused ("no guest checked in"). The front desk posts it as a late Charge. A late-charge flow would need its own decision.
- **Shared-browser exposure:** someone using the app in the same browser can read what is kept there, including another user's waiting changes and their keys. It is limited to enrolled Devices and one day.
- **Offline reopening** works only in a production build. Development mode does not register the service worker.
- **Sessions on several properties:** without an enrolled Device, a user with floor roles at several properties works the first one.
- **Code names:** the code still says "floor" for the Phone View (`/floor`, `floorDay`).

