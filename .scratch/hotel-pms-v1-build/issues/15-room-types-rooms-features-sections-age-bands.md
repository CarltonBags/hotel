# 15 — Room Types, Rooms, Room Features, Sections and Age Bands

**What to build:** A Property Manager defines Room Types (max occupancy, max adults, bed places and extra beds with dated history for statistics), Rooms with floor and Room Features (view, bed type, connecting door, accessible, balcony), Sections (floor or wing) for housekeeping, and Age Bands per property. Room type and room names carry a version per enabled guest language with fallback marking.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages

**Status:** done

- [x] A property with 400 rooms across 20 room types is created and listed quickly
- [x] Room Features and Sections editable and shown on the room
- [x] Age Bands validate as contiguous and non-overlapping
- [x] Bed place changes keep dated history

## Comments

2026-10-01: built and reviewed. Tenant migration 0003: room_types (code, main-language name plus names per guest language, max occupancy, max adults, bed defaults), rooms (number, optional name with translations, floor, Section, bed places and extra beds), room_features and assignments, sections, room_capacity_history (dated, in the property's own calendar; the room's current counts follow the row in effect today), age_bands. Screen: Room Types and Rooms under Settings, property-scoped through the navbar switcher, with tabs for Room Types, Rooms (bulk add by ranges like 101-140, inline edit, search), Room Features, Sections and Age Bands.

Acceptance as proven: 20 types x 400 rooms created and listed in under half a second (db test); features and sections assigned and shown on the room (db test and browser); age bands contiguous and non-overlapping (domain test, db test, browser: gap refused with a translated message); bed place changes keep a dated history (db test).

Review findings fixed: every write scoped to the property (a Property Manager could have edited another property's rooms within the tenant); section ownership checked; future-dated capacity changes no longer overwrite the current counts; translations merge instead of being wiped; strict age band parsing; room names per language added; rooms module visible only to users who manage a property; Drizzle mirrors carry the check constraints; multi-row room insert.

Left for later tickets: Room Features are a flat catalogue per property (view, bed type, balcony, ...); floor is a room attribute, Sections are free-named. Guest languages are fixed to German and English until the Guest Portal (ticket 40) adds the per-property switch. Deleting rooms or types with reservations attached needs a guard once reservations exist (ticket 21).
