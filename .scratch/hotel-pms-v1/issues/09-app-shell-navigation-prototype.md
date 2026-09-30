# App shell and multi-tab navigation prototype

Map: ../map.md
Type: prototype
Status: resolved
Blocked by: 06

## Question

What should the staff app shell look like? Build UI variants of the shell: primary navigation, the in-app multi-tab workspace (open a reservation, a guest, a report as tabs; close and reorder), property switcher for multi-property users, light and dark mode, icon treatment. Guided by the Warmwind design brief. Pick one direction to carry into every later screen.

## Answer

Resolved 2026-09-28 by prototype, two rounds, verdict given by the product owner in the browser.

**Winner: variant E, "Top navbar + Menu + pinned tabs".** Round 1 compared A (rail + stage), B (top bar + browser tabs), C (dock + split view); A won on look but the owner asked for a main menu button, navbar quick access, tabs below the navbar and pinning. Round 2 built both readings of "navbar" (D left rail, E top bar); E won.

The shell, top to bottom:

1. **Navbar** (floating, top): **Main Menu** button at the far left; property switcher (with "All properties" for multi-property users); **Quick Access** buttons; search; theme toggle; user.
2. **Tab strip** directly below the navbar: **Pinned Tabs** first, then open Workspace Tabs, then "New reservation".
3. **Stage**: one full-width rounded surface showing the active tab. No left rail.

Decisions:

- **One browser tab only.** Everything opens as a Workspace Tab inside the app; the app never opens a second browser tab or window.
- **Main Menu** is the single entry to every function, as a nested menu: groups on the left (Front desk, Lists, Cash and billing, Rates and availability, Guests, Housekeeping, Reports, Settings), items on the right (House list, Breakfast list, Kassenbuch, Night audit, ...), with a search field on top. Choosing an item opens it as a tab.
- **Quick Access** is per-user configurable, with defaults per role; any Main Menu item can be added to or removed from the navbar by the user.
- **Pinned Tabs** are icon-only, sit first, cannot be closed until unpinned, and are restored at next login per user and property.
- **Tabs** can be opened, closed, reordered by drag, and pinned. Module tabs are singletons; record tabs (reservation, guest) are one per record.
- **Light and dark mode** both required, switchable per user.
- **Accent colour is chosen by the tenant** (brand colour) in settings; product default is Ocean blue `#0071e3`. Both themes derive their accent from it. Semantic colours (success, warning, danger) do not change with the accent.
- **Size and personality**: bigger and airier than the first round (44-48px navbar controls, 40px tabs, 14-15px text), coloured icon tiles per module, soft accent wash on the canvas. Tables inside the stage stay compact.
- Click-first: every function reachable by mouse in at most two clicks from the navbar or Main Menu. Forms are fully keyboard-operable (Tab order, visible 2px focus ring).
- Split view (variant C) was not chosen and is not in v1.

Assets:

- Screenshots: `docs/design/app-shell/` (winner: `round2-E-top-navbar-WINNER.png`, menu open: `round2-E-main-menu-open.png`, dark: `round2-E-dark.png`).
- Prototype code, all five variants: `apps/staff-shell-prototype/` (throwaway; run `pnpm --dir apps/staff-shell-prototype dev`, open `/prototype/shell?variant=E`). Not yet committed to a throwaway branch: the repo has no commits and committing waits for the owner's go-ahead.
- Design tokens the prototype used: `apps/staff-shell-prototype/app/globals.css`, derived from `docs/research/warmwind-design-language.md`.
