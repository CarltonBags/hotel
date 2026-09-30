# 91 — Rates and history import, channel fetch matching and switching day

**What to build:** Rates and Restrictions per rate plan and room type for the horizon and history as daily figures (up to 3 years: rooms sold, rooms available, Net Room Revenue, total revenue) are imported and feed last-year comparison and pace. After connecting the channel manager the system triggers its fetch of future bookings for the sites that support it and matches by channel booking number against imported reservations; mismatches are listed; nothing is inserted twice; the first full availability push is computed from imported reservations. A switching-day checklist (rehearsal import, last audit of the old system, final import, list check, channels switched) is shown in the setup guide.

**Blocked by:** 90 Data import: reservations, guests, companies and open money, 38 Channel bookings inbound and per-channel settings

**Status:** ready-for-agent

- [ ] History import produces correct last-year comparison figures
- [ ] Fetched booking with a known number matches; unknown number lands on the mismatch list
- [ ] First availability push equals rooms minus imported reservations
