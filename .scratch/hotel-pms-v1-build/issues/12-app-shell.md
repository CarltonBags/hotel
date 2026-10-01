# 12 — App shell with tabs, Main Menu, themes and languages

**What to build:** The staff app shows the shell decided by the prototype (variant E): floating navbar with Main Menu button, property switcher with "All properties" for multi-property users, per-user Quick Access buttons, search, theme toggle and user menu; a tab strip with Pinned Tabs first, then Workspace Tabs, then "New reservation"; one full-width Stage. Tabs open, close, reorder by drag and pin; module tabs are singletons, record tabs one per record; pinned tabs restore at next login per user and property. Light and dark mode per user; accent colour chosen by the tenant with Ocean blue as default. German and English per user using the fixed German glossary terms; dates, numbers and currency follow the user's language; Swiss number format for Swiss properties; week starts Monday. Every function reachable in at most two clicks; forms keyboard-operable with a visible focus ring.

**Blocked by:** 11 Legal Entities, Properties, users and roles

**Status:** done

- [x] Shell matches docs/design/app-shell round 2 variant E in light and dark
- [x] Pinned tabs survive logout and login; a second browser tab is never opened
- [x] Main Menu lists every registered module grouped as decided, with search
- [x] Switching the user language to German shows the glossary's German terms on every shell label
- [x] Tenant accent colour changes both themes; semantic colours stay fixed

## Comments

2026-10-01: built and reviewed. Shell as decided (variant E): floating navbar with Main Menu (eight groups, search, star to add or remove Quick Access), property switcher with "All properties" for multi-property users, Quick Access with defaults per role, navbar search over modules, theme toggle, user menu (language, theme, account, sign out); tab strip with Pinned Tabs first, Workspace Tabs with drag reorder, "New reservation"; one Stage. Module tabs are singletons, record tabs one per record (API ready, no record pages yet). Pinned Tabs are stored per user and property scope as full tab records, so they restore on any device. Light, dark and system themes per user; tenant accent (four presets) applied to both themes through --accent-light/--accent-dark; semantic colours fixed. German and English per user with the glossary's words; dates, numbers and currency per language with the Swiss format for Swiss properties (library in packages/domain; only dates are rendered so far). Every Main Menu item lists the ticket that builds it and opens a placeholder.

Verified: 79 unit tests (tab reducer, registry, messages against the glossary file, formats, preferences, workspace), typecheck, builds, and a 15-step browser walkthrough (screenshots in the session scratchpad): menu, search, open as tab, pin, dark, German labels incl. Tagesabschluss/Kassenbuch/Gesellschaften, property switch, accent change, pinned tab restored after sign-out, sign-in and cleared local storage.

Review findings fixed: html lang and first-paint theme/accent from cookies set at sign-in; accent in system theme; serialised pinned-tab saves; atomic preference upsert; corrupt local storage tolerated; arrow-key navigation in menus; stale "all" scope for single-property users; role and country names translated; glossary words (Cleanliness, Meldeschein).

Defaults chosen here, to confirm: a third theme "system"; Quick Access capped at eight; accent limited to four presets (a free brand colour can follow); week start and number formats are wired for later screens.
