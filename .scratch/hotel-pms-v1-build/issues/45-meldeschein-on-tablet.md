# 45 — Meldeschein registration on the tablet

**What to build:** On a reservation, Front Desk opens guest registration: per guest the system shows whether they need their own form, are counted on a family form, or need nothing, from the property's country (Germany: foreign nationals only, spouse, partner and minors by count and nationality; Austria: all guests, minors on a parent's form) and the guest's data. The desk picks an enrolled tablet Device and sends the registration; one send queues every guest needing a form, the tablet runs them in turn; a tablet serves one reservation at a time and the desk can take it back. Tablet steps per guest: welcome with language choice, details (editable personal fields, arrival and departure read-only, statutory fields only), companions, review, completion; the desk sees progress live. Completion: Austria signs on the tablet; Germany prints the completed form for a handwritten signature (the card path comes in ticket 46). The desk records the ID Check; registration completes only with both. Stored: structured record, how it was confirmed, ID Check result, rendered PDF; automatic deletion Germany between day 365 and 455 after departure, Austria after 7 years. Guest edits write back to the profile logged as tablet edits.

**Blocked by:** 14 Devices and PIN Sign-in, 26 Check-in with folio posting, Charges and Routing Rules

**Status:** ready-for-agent

- [ ] Matches docs/design/meldeschein flow for the tablet
- [ ] A German national at a German property needs no form; a foreign family gets one form with counts
- [ ] Austrian tablet signature image stored with the record and rendered on the PDF
- [ ] Deletion job removes a German record on day 400 and keeps an Austrian one
