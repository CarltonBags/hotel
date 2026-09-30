# 35 — Housekeeper and Maintenance phone view, offline and ten languages

**What to build:** On an enrolled phone, a Housekeeper sees the list by Section from the prototype: rows with task icon, large room number, minutes, surname, flags, state; the room sheet with Start and Done (Done sets Clean, Undo afterwards), guest declined and do not disturb, minibar counters posted as Charges from the catalogue, report problem and lost and found with photo first. Housekeeping Notes from the property's fixed icon list shown in the phone's language. Maintenance sees its queue with "I take it" and "Fixed". Languages per user: German, English, Polish, Romanian, Bulgarian, Croatian/Serbian/Bosnian, Hungarian, Turkish, Ukrainian, Arabic with right-to-left layout. Offline: tasks stored on the phone at Publish, changes and photos queued as "waiting to send", supervisor's newer change wins with a notice; installable on the home screen; stored data encrypted and wiped on revoke.

**Blocked by:** 34 Housekeeping Tasks, Sections and the supervisor board, 14 Devices and PIN Sign-in

**Status:** ready-for-agent

- [ ] Matches docs/design/housekeeping variant A
- [ ] Airplane mode: Done, minibar and a problem report with photo queue and send after reconnect under the right user
- [ ] Conflict with a supervisor change resolves supervisor-wins and tells the housekeeper
- [ ] Arabic renders right-to-left; all ten languages load
