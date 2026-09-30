# Warmwind OS design language

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

What does Warmwind OS look and feel like, and which of its design traits should the PMS adopt? Find primary sources (official site, product videos, screenshots). Extract: layout model, window/tab handling, colour and typography, icon style, motion, light/dark treatment, density. Write a short design-language brief that the app-shell prototype can build against, noting which traits conflict with a data-dense staff tool.

## Answer

Warmwind OS (Warmwind AG, Jena; beta Jul 2025, public 26 Aug 2026) is a browser-delivered "AI operating system": a React chrome around a streamed Linux desktop that AI workers drive by mouse and keyboard. The company publishes no design docs, so the look was reconstructed from its production CSS bundle, official video frames and Play Store screenshots; single-frame inferences are marked UNVERIFIED.
Look: light-only chrome (canvas #f2f2f2, surface #fff, ink #171a1d at alpha steps), Satoshi 400/500 body with Circular headings and tight negative tracking, Lucide monochrome icons, pills everywhere (radius 1000px) with 10/14/20/26px for rows/popovers/cards/glass, depth from hairline inset highlights rather than borders, small motion vocabulary (120ms/280ms, strong ease-out), and dark blurred-glass cards over alpine wallpaper. Layout is a wide-inset left rail plus one big rounded "stage"; no OS windows or tabs, workers are switched from the rail.
Adopt: rail + rounded stage shell (stage hosts our tab strip), ink-alpha colour system mirrored for dark mode, hairline-shadow depth, light-weight geometric type, Warmwind's motion tokens, Lucide icons, and the wallpaper + dark-glass hero for the self check-in kiosk.
Conflicts and fixes: 40-50px controls and 24px padding (add a compact tier for the stage), no tabs (pill tab strip + split stage), backdrop blur and wallpaper (kiosk/login only), light-only (design dark tokens now), hover-scale and weak focus (2px accent focus ring, no scale on inputs/rows), low-contrast alpha text (floor secondary at #171a1d99, add 600 weight for tables), fluid font sizes (fixed px inside the stage).
Proposed starting tokens (fonts, radius scale, 4px spacing, light/dark palettes, shadow and motion recipes) and full sources are in ../../../docs/research/warmwind-design-language.md.
