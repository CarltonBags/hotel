# Warmwind OS as a design reference for the staff PMS

Research note, 2026-09-24. Resolves ticket `.scratch/hotel-pms-v1/issues/06-warmwind-design-reference.md`.

Evidence quality, up front: Warmwind publishes no design documentation, style guide or press kit. The company's own posts and press releases describe *what the product does*, not what it looks like, and every third-party article found repeats those posts. The reliable primary sources for the *look* are therefore (a) the production CSS bundle served from warmwind.com, which is the real app shell (it contains the `noVNC` capture element, `AuthenticatedChrome`, `SpaceSidebar`, `SpaceWallpaper`, etc.), (b) the official launch-video thumbnail and the official YouTube channel's auto-generated frames, and (c) the Google Play listing screenshots of the companion app. Everything below is tagged by source; anything derived from a single low-resolution frame is marked UNVERIFIED.

## 1. What Warmwind OS is

- Product: "warmwind OS", sold as "the world's first AI operating system" / "autonomous cloud employees". Each AI worker gets an isolated cloud computer and operates ordinary software visually with a virtual mouse and keyboard; no API integrations. (Press release, 26 Aug 2026 [S1]; closed-beta release, 3 Jul 2025 [S2].)
- Company: Warmwind AG (formerly eva AG), Jena, Germany. Founders quoted: CEO Maximilian Schilling, co-founder Richard Wieduwilt. About 15 employees; ~90,000 registrations and EUR 450k ARR at public launch; pricing EUR 1.00-1.50 per hour of active execution. [S1]
- Timeline: closed beta announced 2-3 Jul 2025 [S2][S3]; public launch ("1.0") 26 Aug 2026 [S1]. Launch video: "Introducing warmwind OS: The World's First AI Operating System" [V1]; beta explainer "How warmwind OS (Beta) Works: Architecture, AI Model and Design" [V2]; "warmwind OS in 78 seconds" [V3]; beta intro [V4]; "Get Started with warmwind" [V5].
- What it technically is: "a custom Linux distribution on the server side", with "Wayland and VNC streaming to send the GUI output to the browser"; the browser is a viewing window, the OS instance keeps running when the tab closes. [S3] So the *inner* desktop the AI drives is a streamed Linux GUI; the *outer* chrome (sidebar, worker list, task input, notifications) is a React web app served from warmwind.com. The design language we care about is that outer chrome.
- Stated design intent: "Enable the AI to act like a human"; the OS "doesn't hide what's happening, but shows it"; "Make advanced AI feel like magic, but work like infrastructure: invisible when you want it, indispensable when you need it." [S4] Third-party coverage of the beta explainer adds: a task list for ongoing/completed tasks, a distinct cursor that shows the AI's actions, a teaching mode, an app store, and an explicit goal of balancing "aesthetic appeal with the performance constraints of a web-based environment". [S5]

## 2. Observed traits

Source keys: CSS = production bundle at warmwind.com/assets/* (fetched 2026-09-24) [S6]; FRAME = launch-video thumbnail / channel frames [V1][V3][V4]; PLAY = Google Play screenshots [S7].

### Layout model
- One full-viewport "chrome" with a generous inset: `.AuthenticatedChrome{--authenticated-chrome-inset:clamp(28px,3.333vw,50px); height:100dvh; padding:var(--inset); gap:var(--inset); flex-direction:row}`. Left: `.SpaceSidebar` (logo 29px, list of workers/"spaces", tag groups, user area with 30px avatar items, notification inbox widget, account budget ring). Right: `.SpaceTop` (the worker's desktop, `border-radius:clamp(14px,2vw,30px); overflow:hidden`). [CSS]
- The desktop is a wallpaper (`.SpaceWallpaper`, object-fit cover, photographic landscape) with a floating top-centre pill of app icons and a floating bottom-centre "Describe your task" input plus a "Teach" button; a small "New worker" pill sits bottom-left. [FRAME V1 thumbnail]
- A right-hand `.SpaceContentSidebar` (width `clamp(280px, ..., 420px)`, slides in with `transform .25s var(--ease-out)`) hosts the "Worklist" (step-by-step task log), assistant chat and teaching mode. [CSS]
- Mobile companion app: single column of cards, bottom segmented tab bar (Notifications | Settings), all rounded. [PLAY]
- Vocabulary: a "Space" is one worker's cloud desktop; "Worklist" is the task log; "Teaching mode" is record-by-demonstration. [CSS class names, S5]

### Window / tab handling
- The streamed desktop is a single canvas; the *outer* chrome does not implement OS-style windows or browser-style tabs. What exists: `.AppWindow` with a small `.AppWindow-Header{padding:6px 7px}` and a 4:3 `.AppWindow-Body` used inside assistant "rich answers" as previews, and `PortalZoom`, a zoom-to-modal transition (`.PortalZoom-Backdrop{background:#171a1ddf}`) for expanding a data sheet or editor. [CSS]
- Multiple workers are switched from the left sidebar, not from tabs. [CSS: `.SpaceSidebar-Spaces-Content-Workers` rows of 36px with animated height/opacity]
- UNVERIFIED: whether the inner Linux desktop shows a dock or window manager chrome; frames are too small to tell. The launch thumbnail shows only a top app-icon strip, not a taskbar.

### Colour palette
- Ink: `#171a1d` (near-black, slightly cool) used everywhere at alpha steps `1a, 1f, 29, 33, 59, 66, 80, 99, cc, df` for borders, shadows, scrims. Page/canvas: `#f2f2f2` ("Silver") and `#fff` ("Light"). [CSS `body{background:#f2f2f2}`, `.AppShell-Main{background:#fff;color:#171a1d}`]
- Semantic: success `#35cb91`, error `#ff3665`, warning `#ffc107`, info/blue `#0071e3` (Apple's link blue), purple `#cc74f8`. [CSS Badge/Button variants]
- Accent gradient (used sparingly on "Gradient" buttons and icon blobs): `radial-gradient(200% 100% at -5% 5%, #cbdbe9 0%, #98cfe3 30%, #a2d6ce 50% 72%, #cbdbe9 100%)` - a pale sky-blue to mint wash. [CSS]
- Dark surfaces are gradients, not flats: `linear-gradient(#434343,#232323)` (dark button), `linear-gradient(#33332f,#232323)` (dark tooltip). [CSS]
- Wallpapers are saturated alpine photography (snow peaks, lakes, forest) in every official frame; the brand identity is "Made in Germany" plus mountains. [FRAME V1, V3, V4; S1 og:image]

### Typography
- Body/UI: **Satoshi** (Regular 400, Medium 500 only; no bold loaded), `font-synthesis:none`, `-webkit-font-smoothing:antialiased`. Headings: **Circular** Medium 500. Decorative script: **Grand Hotel** (used for the "Welcome" on the beta thumbnail). [CSS @font-face; FRAME V4]
- Sizes are fluid clamps: body `clamp(14px, .3125vw + 8px, 16px)`; small `clamp(12px, .3125vw + 6px, 14px)`; tooltip 11px; badge tiny 10.5px. Headings: H1 roughly 40-56px, H2 30-42px, H3 20-28px, all with negative tracking (-3% to -4%) and tight line-height 1.15-1.2. Buttons/labels carry -0.35px letter-spacing. [CSS]
- Weight discipline: only 400 and 500. Emphasis is done with colour alpha (`#171a1d` vs `#171a1dcc` vs `#171a1d99` vs `#171a1d66`) rather than weight. [CSS]

### Icon style
- `lucide` SVG icons (`.Button svg.lucide{stroke:currentColor;fill:none}`), sized 16/20/22px for tiny/small/default buttons. Icons are monochrome, inherit text colour, and a `data-filled` variant exists. [CSS]
- App icons are real third-party app logos in rounded squares (`.AppIcon{border-radius:clamp(4px, size*.4-6px, 10px)}`, 30px default); the top strip in the launch frame shows WhatsApp, LinkedIn, Calendar, Word, Excel, Gmail, "+". [CSS; FRAME V1]
- "Icon-Blob": 60px circular pads behind icons with inner-glow shadows; a "Success" green variant. [CSS]

### Motion
- Global easing tokens: `--ease-out:cubic-bezier(.16,1,.3,1)` (strong ease-out), `--ease-in:cubic-bezier(.4,0,.7,.4)`, `--ease-in-out:cubic-bezier(.65,0,.35,1)`, `--ease-drawer:cubic-bezier(.32,.72,0,1)`; durations `--motion-quick:.12s`, `--motion-entrance:.28s`. [CSS :root]
- Buttons: hover `filter:brightness(.98); scale:.98`, active `brightness(.96); scale:.95`, all at 120ms; hover-only on `(hover:hover) and (pointer:fine)`. Tooltips fade+scale from .97 in 100ms with a 250ms delay. Nav icons lift 1px and scale 1.05 on hover. Sidebars slide 250ms. Data-sheet rows shimmer green on insert/update and red on delete (`SkeletonShimmer` 0.8s). Small "wiggle" and "highlight" keyframes for attention. Framer Motion (`AnimatePresence` chunk) is bundled. [CSS; bundle chunk list]
- Reduced-motion: only Bootstrap's vendor rule; no custom `prefers-reduced-motion` handling found. [CSS]

### Light / dark treatment
- Shipped chrome is **light-only**: page `#f2f2f2`, cards `#fff`, ink `#171a1d`. No `prefers-color-scheme`, `data-theme` or `.dark` root rules exist anywhere in the fetched bundles. "Dark" in class names (`Button-Dark`, `Tooltip-Box.Dark`, `Input-Wrapper.Glass.Dark`) means a dark *component variant* placed over a wallpaper, not a theme. [CSS]
- Dark-on-photo glass is the signature: worklist items are `background:#171a1d59; backdrop-filter:blur(clamp(18px,.65vw,50px)); border-radius:26px` over the wallpaper; "Glass" inputs are `#171a1d33` rising to `#171a1d66` on hover/focus; the wallpaper itself gets `blur(...) brightness(.9) saturate(1.25); scale:1.1` when a card needs focus, or `blur(4px) brightness(.8) saturate(.75)` when dimmed. [CSS]
- Conclusion: Warmwind proves the look works over dark, blurred photography; it does not demonstrate a true dark UI theme. A PMS dark mode has to be designed, not copied. UNVERIFIED whether a dark theme exists behind login.

### Density
- Low. Buttons are 50px tall by default (40 small, 30 tiny), inputs 40px (50 medium), tooltips capped at 240px, sidebar rows 36px, card padding 24px, chrome inset 28-50px, section gaps 24-60px. Data appears only in a `DataSheet` whose cells are `min-width:16ch; max-width:28ch` with 14px x-padding and a whole-table `--conv-scale` of 0.9-1.2. This is a conversational tool with one primary input; it never shows more than a handful of records at once. [CSS]

### Glass / blur / depth
- Depth comes from stacked hairline shadows rather than borders. The reusable "pill" recipe: `0 2px 12px -4px #171a1d1a, inset .5px 0 #171a1d1a, inset -.5px 0 #171a1d1a, inset 0 1.25px 0 -.5px #ffffff4d, inset 0 -1.25px 0 -.5px #ffffff4d` (top and bottom inner highlights = a lit rim). The "card" recipe: `inset 0 -.5px .25px #171a1d1a, inset 0 .5px .25px #171a1d14, inset 0 2px 4px #fff6, inset 0 -2px 4px #fff6, 0 4px 10px -8px #171a1d1a`. Coloured buttons add `inset 0 -4px 20px -4px #171a1d33` (bottom shade) and `inset 0 2px 1px #fff9` (top gloss). [CSS]
- Radii: pills `1000px` for every button, badge, avatar, scrollbar thumb and progress track; cards/inputs 20px; tooltips/selects 14px; option rows and app tiles 10px; app picker 26px; overlay cards `clamp(20px,3vw,30px)`; desktop frame `clamp(14px,2vw,30px)`. Nothing is square. [CSS]
- Scrollbars are 4px, transparent track, pill thumb `#171a1d33`; the "Notch" sticky header hides content with a `0 -30px 60px 60px #fff` fog rather than a line; lists fade at both ends with a mask-image gradient. [CSS]
- Backdrop blur is used on 9 rules total, all over the wallpaper; the light chrome itself is opaque. [CSS]

## 3. Traits to adopt for the staff PMS

1. **The two-layer shell.** A calm light frame with a large inset, a single left rail for navigation and identity, and one big rounded "stage" for content (`SpaceTop`). Map: rail = properties/modules + user area; stage = the multi-tab workspace. This is exactly the click-first model the owner wants; Warmwind has no keyboard chrome at all, so keyboard operability is ours to add inside the stage.
2. **Ink-alpha colour system.** One ink (`#171a1d`), one canvas (`#f2f2f2`), one surface (`#fff`), with hierarchy expressed through alpha steps of the ink rather than a grey ramp. It stays coherent in both themes if we mirror it (white ink at alpha over a dark canvas). Keep the four semantic colours; they are already close to what a PMS needs (paid/green, overdue/red, attention/amber, info/blue).
3. **Depth by hairline highlight, not border.** The pill and card shadow recipes are cheap, look "Apple-modern", and survive dark mode with the alphas flipped. Use them for cards, toolbars, popovers; never on table rows.
4. **Weight-light typography.** A geometric grotesk at 400/500 only, negative tracking on headings, fluid sizes, `font-synthesis:none`. Emphasis via ink alpha. This scales down to dense tables better than a heavy UI font.
5. **Motion tokens.** The four easings and two durations are a complete, small motion vocabulary. Adopt as-is: 120ms quick / 280ms entrance, strong ease-out for anything entering, drawer easing for side panels. Add a `prefers-reduced-motion` gate Warmwind lacks.
6. **Lucide icons, monochrome, currentColor**, 16/20/22px steps, with an explicit filled state for "active". Meaningful icon + short label in the rail (Warmwind's `AppChromeNav-Link` is icon over 14-16px label, active = full ink + weight 500).
7. **Rounded everything, with a radius scale, not a single value.** Pills for actions and status, 20px for panels, 10-14px for rows, tiles and popovers.
8. **Blurred-photo hero for the guest-facing surface.** The wallpaper + dark-glass card is a strong fit for the separate Apple-like self check-in kiosk (one task, one card, large type, hotel photography behind it), where density is not a concern.
9. **State-change shimmer on rows** (green insert/update, red delete) is a good pattern for a live reservation grid receiving channel-manager updates.

## 4. Traits that conflict with a data-dense staff tool, and the resolution

| Warmwind trait | Conflict | Resolution |
|---|---|---|
| 50px buttons, 40px inputs, 24px card padding, 28-50px chrome inset | A front-desk grid, rate table or folio needs 28-32px rows and hundreds of visible cells | Two density tiers. "Comfortable" (Warmwind's sizes) for the rail, headers, dialogs, kiosk. "Compact" (32px controls, 8px cell padding, 12/13px text) inside the stage for tables and forms. Keep the same radii and shadows, scale spacing by 0.65. |
| No windows, no tabs; one worker = one desktop | Owner wants an in-app multi-tab workspace (reservation + guest + folio open at once) | Tabs live in the stage header as pills (Warmwind's pill/badge recipe), one row, closable, with the active pill in full ink. Split view = two stages side by side inside the same rounded frame. Do not attempt free-floating windows. |
| Backdrop blur on content cards | Blur over a busy table is unreadable and costs GPU on cheap front-desk PCs; blur is also the first thing to break in high-contrast modes | Blur only on layers that sit over imagery: the kiosk, login, and empty states. Inside the stage, popovers and sheets are opaque `#fff` / dark surface with the card shadow recipe. |
| Photographic wallpaper behind the workspace | Staff stare at this 8 hours; a landscape behind a reservation grid is noise | Wallpaper is confined to login, lock screen and kiosk. Stage background is flat canvas. |
| Light-only chrome | Owner requires light and dark | Define both themes as token sets from day one: ink/canvas/surface flip, alphas kept, shadows switch from dark-alpha to light-alpha rims. Warmwind's dark button gradient (`#434343 to #232323`) is a reasonable starting dark surface. |
| Hover-driven affordances (`scale .98`, icon lift), no visible focus ring except Bootstrap default | Keyboard-first data entry needs an unmistakable focus ring and no layout jitter | Keep the hover micro-scale on buttons only; forbid scale on inputs and rows. Add a 2px `#0071e3` outline-offset focus ring on every focusable, roving tabindex in grids, Enter/Tab conventions documented. |
| Only 400/500 weights, small text at 11-14px with alpha `#171a1d66` | Below 4.5:1 contrast for secondary text on `#f2f2f2`; a PMS needs WCAG AA for long shifts | Floor secondary ink at `#171a1d99` (approx. 5:1) and disabled at `#171a1d66` only when non-interactive. Add a 600 weight for table headers and totals. |
| Pill radius (1000px) on everything | Pills on a 32px table cell button waste 8px per side; status pills in a column look like buttons | Pill only for standalone actions and status chips in headers; 8px radius for in-cell controls; 6px for tags inside tables. |
| Fluid `clamp()` font sizes tied to viewport | Data screens must be predictable across 1366px front-desk laptops and 27" back-office monitors | Fixed px sizes inside the stage; fluid sizes only for the marketing-grade surfaces (kiosk, onboarding). |
| Fog-mask list edges and hidden scrollbars | Staff need to see that a list scrolls and where they are in it | Standard 8px scrollbar in the stage; keep the 4px pill scrollbar only in the rail. |

## 5. Concrete tokens to start from (PROPOSALS, not measured from Warmwind unless noted)

```css
/* ---- type ---- */
--font-ui:   "Satoshi", "Inter", system-ui, sans-serif;   /* Warmwind uses Satoshi (measured). Satoshi is a paid/limited Fontshare licence; Inter or Geist are drop-in free alternatives with the same geometric feel. */
--font-head: "Circular", "Satoshi", "Inter", sans-serif;  /* Warmwind heading font (measured). Proposal: drop Circular, use one family at 500/600. */
--font-mono: "JetBrains Mono", ui-monospace, monospace;   /* proposal: folio numbers, confirmation codes */
--text-xs: 11px; --text-sm: 13px; --text-md: 14px; --text-lg: 16px;   /* compact tier, fixed px (proposal) */
--text-xl: 20px; --text-2xl: 28px; --text-3xl: 40px;                  /* headings; tracking -0.02em to -0.04em (Warmwind uses -3% to -4%) */
--weight-regular: 400; --weight-medium: 500; --weight-semibold: 600;  /* Warmwind ships 400/500 only; 600 is our addition for tables */

/* ---- radius ---- */
--radius-xs: 6px;   /* in-table tags (proposal) */
--radius-sm: 10px;  /* rows, tiles, menu options (Warmwind 10px) */
--radius-md: 14px;  /* popovers, selects, tooltips (Warmwind 14px) */
--radius-lg: 20px;  /* cards, inputs, sheets (Warmwind 20px) */
--radius-xl: 26px;  /* app picker / glass cards (Warmwind 26px) */
--radius-stage: clamp(14px, 2vw, 30px);  /* the workspace frame (Warmwind .SpaceTop) */
--radius-pill: 1000px;                    /* buttons, chips, avatars (Warmwind) */

/* ---- spacing (4px base; Warmwind's observed steps are 4/8/12/16/24/32/40) ---- */
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
--chrome-inset: clamp(20px, 2.5vw, 40px);  /* Warmwind clamp(28px,3.333vw,50px); reduced for density (proposal) */
--control-h-comfortable: 40px; --control-h-compact: 32px; --row-h-compact: 32px;  /* proposal; Warmwind 40/50px */

/* ---- colour, light ---- */
--ink:      #171a1d;               /* Warmwind ink (measured) */
--canvas:   #f2f2f2;               /* Warmwind page (measured) */
--surface:  #ffffff;               /* Warmwind card (measured) */
--ink-90: #171a1de6; --ink-80: #171a1dcc; --ink-60: #171a1d99; --ink-40: #171a1d66; --ink-20: #171a1d33; --ink-10: #171a1d1a; --ink-5: #171a1d0d;
--accent:   #0071e3;               /* Warmwind info/blue (measured); focus ring + primary action */
--success:  #35cb91; --danger: #ff3665; --warning: #ffc107; --purple: #cc74f8;   /* Warmwind (measured) */
--accent-wash: radial-gradient(200% 100% at -5% 5%, #cbdbe9 0%, #98cfe3 30%, #a2d6ce 50% 72%, #cbdbe9 100%);  /* Warmwind (measured); kiosk/hero only */

/* ---- colour, dark (proposal; Warmwind ships no dark theme) ---- */
--ink:      #f2f2f4;
--canvas:   #131416;               /* derived from Warmwind ink, slightly lifted */
--surface:  #1d1f22;               /* between Warmwind's #232323 gradient stop and ink */
--surface-raised: linear-gradient(#2a2c30, #1d1f22);   /* echoes Warmwind's dark button gradient */
--ink-90 ... --ink-5: same alphas on #f2f2f4;
--accent: #4c9dff; --success: #4ad9a1; --danger: #ff5c80; --warning: #ffcd3c;    /* lifted for contrast on dark */

/* ---- depth (Warmwind recipes, measured) ---- */
--shadow-pill: 0 2px 12px -4px var(--ink-10), inset .5px 0 var(--ink-10), inset -.5px 0 var(--ink-10), inset 0 1.25px 0 -.5px #ffffff4d, inset 0 -1.25px 0 -.5px #ffffff4d;
--shadow-card: inset 0 -.5px .25px var(--ink-10), inset 0 .5px .25px var(--ink-5), inset 0 2px 4px #fff6, inset 0 -2px 4px #fff6, 0 4px 10px -8px var(--ink-10);
--shadow-pop:  var(--shadow-card), 0 12px 24px -10px #0000001a;
/* dark mode: swap the #fff inner highlights for #ffffff14 and the outer drop for #00000066 (proposal) */

/* ---- motion (Warmwind, measured) ---- */
--ease-out: cubic-bezier(.16,1,.3,1); --ease-in: cubic-bezier(.4,0,.7,.4); --ease-in-out: cubic-bezier(.65,0,.35,1); --ease-drawer: cubic-bezier(.32,.72,0,1);
--motion-quick: 120ms; --motion-entrance: 280ms;
@media (prefers-reduced-motion: reduce) { * { transition-duration: 0ms !important; animation: none !important; } }   /* our addition */

/* ---- glass (kiosk / login only) ---- */
--glass-bg: #171a1d59; --glass-blur: clamp(18px, .65vw, 50px);   /* Warmwind worklist card (measured) */
--wallpaper-focus: blur(var(--glass-blur)) brightness(.9) saturate(1.25);  /* Warmwind (measured) */
```

Icon set proposal: Lucide (matches Warmwind), 16px in compact tables, 20px in toolbars, 22px in the rail; stroke 1.75; filled variant for active rail item.

## 6. Open questions / what could not be verified

- No official screenshot of the logged-in desktop at usable resolution is public; the layout description above combines CSS structure with a 1280x720 thumbnail. A 10-minute session in a free Warmwind account would confirm the rail/stage split and whether the inner Linux desktop has a dock. Marked UNVERIFIED where relevant.
- No dark theme found in shipped CSS; if the owner has seen a dark Warmwind, it was a dark-glass component over a wallpaper.
- Font licensing: Satoshi (Indian Type Foundry via Fontshare) and Circular (Lineto) are not free for all uses; the token block proposes Inter/Geist fallbacks.
- The X launch post [S8] and the Medium mirror of [S3] returned 402/403 to automated fetches; the about.warmwind.com originals were used instead.

## 7. Sources

- [S1] Warmwind AG press release, "Warmwind Launches International Rollout of Autonomous AI Workers", 26 Aug 2026. https://about.warmwind.com/warmwind-launches-international-rollout-of-autonomous-ai-workers/
- [S2] eva AG press release, "Autonomous Cloud Employees Enter Closed Beta", 3 Jul 2025. https://about.warmwind.com/warmwind-closed-beta/ (mirror: https://about.warmwind.space/warmwind-closed-beta/)
- [S3] warmwind, "We Built an Operating System for AI ..But Is It Really One?", 3 Jul 2025. https://about.warmwind.com/we-built-an-operating-system-for-ai-but-is-it-really-one/ (Medium mirror: https://medium.com/@warmwind/we-built-an-operating-system-for-ai-but-is-it-really-one-e4d9ef3fec97)
- [S4] warmwind, "Warmwind OS: Building the AI Operating System for Everyone", 2 Jul 2025. https://about.warmwind.com/warmwind-os-building-the-ai-operating-system-for-everyone/
- [S5] Geeky Gadgets, "How warmwind OS Works: Architecture, AI Model and Design", 7 Jul 2025 (secondary; summarises [V2]). https://www.geeky-gadgets.com/warmwind-os-ai-operating-system/
- [S6] Production web bundle, https://warmwind.com/ (warmwind.space 301-redirects here), fetched 2026-09-24: `/assets/main-T1El4IhJ.css`, `Button-BYlQM38i.css`, `Heading-CRRBx-R4.css`, `Badge-Bb9tvskW.css`, `SheetHost-CYV-8M_n.css`, `AppPicker-CLIYvhj-.css`, `Tooltip-CG7BtsSc.css`, `InputSelect-p6EEkPrX.css`, `InputRequiredMarker-BU7ZfwtN.css`, `Avatar-CVz-8JQu.css`, `app-shell-CZcLAvFC.css`, `authenticated-app-chrome-CebMRGqt.css`, `space-wallpaper-4n3Vhwsl.css`, `Space-Bwf8Bz26.css`, `PortalZoom-Dy2zinqU.css`, `app-icon-Da_0gvJK.css`, `notification-card-CThv1M48.css`, `vendor-ui-CqLr8KVv.css` (Bootstrap 5), plus `/assets/main-Ch4XPYBx.js` for the chunk manifest. Hashes will rotate on deploy; re-fetch from the HTML `<link rel=stylesheet>` list.
- [S7] Google Play listing, "Warmwind" (co.median.android.jbebaqp), updated 19 Aug 2026, two screenshots. https://play.google.com/store/apps/details?id=co.median.android.jbebaqp&hl=en_US
- [S8] warmwind on X, launch post, 26 Aug 2026 (not fetchable without login). https://x.com/warmwind_OS/status/2092508962377576638
- [V1] YouTube, warmwind, "Introducing warmwind OS: The World's First AI Operating System" (launch video linked from [S1]). https://www.youtube.com/watch?v=x_ST4jvZk_A
- [V2] YouTube, warmwind, "How warmwind OS (Beta) Works: Architecture, AI Model and Design". https://www.youtube.com/watch?v=viJewkDqqN4
- [V3] YouTube, warmwind, "warmwind OS in 78 seconds". https://www.youtube.com/watch?v=8gcPLSJjggg
- [V4] YouTube, warmwind, "Introducing warmwind OS Beta: The World's First AI Operating System". https://www.youtube.com/watch?v=x78KpaMu-zQ
- [V5] YouTube, warmwind, "Get Started with warmwind". https://www.youtube.com/watch?v=7cscwG3nuNk
- Channel: https://www.youtube.com/@warmwind_OS
