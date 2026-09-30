# 59 — Rooming lists, Master Folio, deposit schedule and group check-in

**What to build:** Held Rooms become Reservations with placeholder names at once or when names arrive; the organiser's rooming list is imported from the spreadsheet template with a mismatch preview or filled in through an organiser link; names change until check-in. The Group has a Master Folio billed to the organiser with group Routing Rules per Service (individual reservations may deviate) producing one invoice listing rooms and nights; a deposit schedule issues Deposit Invoices and reminders; on shrink or cancel the system shows the contract text and staff post the fee. The group check-in screen lists all reservations of the arrival, assigns rooms in bulk keeping the group together by floor or Section, and checks in selected or all at once; in Germany the tour leader of a group above ten persons registers for all foreign members by count and nationality.

**Blocked by:** 58 Groups, Held Rooms, Tentative and Definite, release and Series, 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** ready-for-agent

- [ ] Rooming list import flags a room type not held and a name over the held count
- [ ] Room, breakfast and City Tax land on the Master Folio, extras on guest folios
- [ ] Bulk assignment keeps the group on one floor when possible
- [ ] Group check-in of 20 reservations posts every folio correctly
