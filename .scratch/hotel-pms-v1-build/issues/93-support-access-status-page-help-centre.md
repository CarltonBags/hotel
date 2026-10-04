# 93 — Support access, status page and help centre

**What to build:** Support staff of the platform open any customer's tenant without asking each time; every access is logged with person, time and reason and is visible to the customer's Owner in a support access list. A public status page shows service state, incidents, planned maintenance (announced 7 days ahead, 02:00 to 05:00 property time) and measured monthly availability against 99.95 %. A help centre is reachable inside the app with the support channels and hours.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages, 13 Worker service: jobs, schedules, live updates and webhook intake

**Status:** in review (PR stacked on ticket 85)

- [x] Support access without a reason is impossible; the Owner sees the entry
- [x] Status page reflects an injected incident and the monthly figure
- [x] Help centre link opens from the user menu

## Comments

**Built**
- Support Staff: users of the platform's own tenant (slug `platform`, override `PLATFORM_TENANT_SLUG`) listed in `control.support_staff`; the auth CLI `create-user … support` adds one.
- Support console `/support` (support staff only, never from inside a customer tenant): pick a tenant, give a reason (≥ 10 characters, checked in domain, DB and form), open. The console makes a one-time code (valid 2 minutes); `/support-access?code=` on the tenant's subdomain redeems it once and sets a host-only `hs_support` cookie holding a separate session secret (4 hours). Inside, the access acts as Tenant Admin with a banner and an "End support access" button; it keeps no pinned tabs or quick-access changes in the customer's tenant.
- Owner list `/settings/support-access` (Owner only): person, start, reason, state; an active access can be ended at once.
- Public `/status`: state (operational / degraded / outage / maintenance), open and recent incidents with updates, planned Maintenance Windows, and this month's availability against 99.95 % (computed from incident minutes over the whole month). Console forms to report and update incidents and to schedule maintenance (≥ 7 days ahead, 02:00–05:00 Europe/Berlin).
- Help centre `/help` from the user menu, with support channels (`SUPPORT_EMAIL`, `SUPPORT_PHONE`), hours and the status page link.
- ADR 0016 (support access as the one exception to ADR 0001); glossary: Support Staff, Support Access, Status Page, Maintenance Window.

**Verified**
- DB tests: one-time code, tenant scoping, expiry, Owner end, membership check, status page and maintenance rules. Domain tests for availability, state and the maintenance and reason rules. All packages typecheck and pass.
- Walkthrough (10/10): short reason refused by the server; support lands in alpha with the banner; the cookie secret differs from the URL code; the code replayed → 403; Owner (bob, German) sees the entry; support ends an access; Owner ends a second access and support is signed out at once; injected incident → status "outage" with the monthly figure; resolving clears it; help centre opens from the user menu.

**Review fixes**
- The URL no longer carries the session secret: a one-time short-lived code is exchanged on arrival (`referrer-policy: no-referrer`).
- Support Staff must belong to the platform tenant; an access started from inside a customer tenant is refused.
- Support access list is Owner only; the Owner can end an access.
- Support sessions no longer write preferences, pinned tabs or quick access into the customer's tenant.
- Availability uses the full month as denominator; the first incident update is stamped at the incident's start.
- Status page dates and incident states follow the language.

**Open points**
- No in-app chat; channels are e-mail and phone.
- Availability counts reported incident minutes only; there is no automatic uptime measurement yet.
- Maintenance hours (02:00–05:00) overlap the Night Audit window; the platform should avoid audit-time maintenance or the audit should retry.
- Support acts with Tenant Admin rights (owner decision); records it writes carry the staff member's user id, which the customer's user list cannot resolve to a name.
- Maintenance times are in Europe/Berlin, hard-coded; a non-existent or doubled 02:xx at a DST change shifts without warning.
