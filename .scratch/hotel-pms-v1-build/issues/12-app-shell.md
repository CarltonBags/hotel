# 12 — App shell with tabs, Main Menu, themes and languages

**What to build:** The staff app shows the shell decided by the prototype (variant E): floating navbar with Main Menu button, property switcher with "All properties" for multi-property users, per-user Quick Access buttons, search, theme toggle and user menu; a tab strip with Pinned Tabs first, then Workspace Tabs, then "New reservation"; one full-width Stage. Tabs open, close, reorder by drag and pin; module tabs are singletons, record tabs one per record; pinned tabs restore at next login per user and property. Light and dark mode per user; accent colour chosen by the tenant with Ocean blue as default. German and English per user using the fixed German glossary terms; dates, numbers and currency follow the user's language; Swiss number format for Swiss properties; week starts Monday. Every function reachable in at most two clicks; forms keyboard-operable with a visible focus ring.

**Blocked by:** 11 Legal Entities, Properties, users and roles

**Status:** ready-for-agent

- [ ] Shell matches docs/design/app-shell round 2 variant E in light and dark
- [ ] Pinned tabs survive logout and login; a second browser tab is never opened
- [ ] Main Menu lists every registered module grouped as decided, with search
- [ ] Switching the user language to German shows the glossary's German terms on every shell label
- [ ] Tenant accent colour changes both themes; semantic colours stay fixed
