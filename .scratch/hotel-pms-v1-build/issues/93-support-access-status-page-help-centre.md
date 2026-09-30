# 93 — Support access, status page and help centre

**What to build:** Support staff of the platform open any customer's tenant without asking each time; every access is logged with person, time and reason and is visible to the customer's Owner in a support access list. A public status page shows service state, incidents, planned maintenance (announced 7 days ahead, 02:00 to 05:00 property time) and measured monthly availability against 99.95 %. A help centre is reachable inside the app with the support channels and hours.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages, 13 Worker service: jobs, schedules, live updates and webhook intake

**Status:** ready-for-agent

- [ ] Support access without a reason is impossible; the Owner sees the entry
- [ ] Status page reflects an injected incident and the monthly figure
- [ ] Help centre link opens from the user menu
