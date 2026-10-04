# 14 — Devices and PIN Sign-in

**What to build:** A Property Manager enrols a shared phone or tablet as a Device of the property by scanning a QR code from the staff app and chooses which users may sign in on it; a staff member's own phone can be enrolled for one user. On an enrolled Device, floor and service roles tap their name and enter a 4 to 6 digit PIN; simple PINs are refused; five wrong tries lock the user everywhere until a supervisor or manager resets the PIN; the device locks after 2 minutes idle (property sets 1 to 10); a new sign-in ends the previous session but keeps its unsent offline changes under that user. Users without email are created with a name and a first PIN and must change it at first sign-in. The Housekeeping Supervisor may create Housekeeper users, reset their PIN and unlock them. Revoking a Device ends its sessions and wipes stored data at next contact; the device list shows last use and last user. Tablets and kiosks for guest flows are enrolled the same way with a long-lived device token and no staff login.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages

**Status:** in review (pull request on branch ticket-14-devices-pin, stacked on ticket-34-housekeeping-tasks)

- [x] PIN works only on an enrolled Device; the same PIN from a normal browser is refused
- [x] Front Desk and other full-credential roles cannot use PIN Sign-in
- [x] Lockout after five wrong tries is logged with device and time
- [x] Revoked Device cannot reach the service and shows a wipe notice

## Comments

**Built (2026-10-04).**

**Enrolment.** The Property Manager (Settings → Devices) names a Device, picks a staff device (shared, with the people who may sign in, or one person's own phone) or a guest tablet or kiosk, and gets a QR code valid for 15 minutes. Opening it on the Device and confirming stores a long-lived token there (httpOnly cookie, kept hashed on our side, renewed at each PIN Sign-in).

**PIN Sign-in.**
- On the Device's lock screen: tap your name, enter a 4 to 6 digit PIN. Only floor and service roles (Housekeeper, Housekeeping Supervisor, Maintenance, Service, Spa Staff) and only people with no other role anywhere.
- The session is valid only together with the Device's token; the same PIN from a normal browser is refused, and so is a stolen session cookie alone.
- A new sign-in ends the previous session on that Device.
- Simple PINs are refused (one digit repeated, runs, repeated pairs, years).
- Five wrong tries lock the user on every Device; each try is taken before the check, so parallel guesses cannot exceed five. Wrong PINs, lockouts and new PINs are logged with Device and time.
- The Device locks after the property's idle minutes (default 2, 1 to 10): in the browser, and on the server, which ends a PIN session idle for longer.

**People without email.** Created with name, Username, role and a first PIN (Settings → Devices, PIN Sign-in). They have no password, so they can sign in only by PIN. A first or reset PIN must be changed before anything else; changing one's own PIN is possible only then, so whoever picks up an unlocked Device cannot take a PIN over.

**Who looks after whom.** The Housekeeping Supervisor creates Housekeepers, sets new PINs and unlocks them; the Property Manager does so for every floor role. Because a PIN works on every Device of the tenant, a person is in reach only if every role they hold, at any property, is one the viewer may give.

**Revoking.** Ends the Device's sessions at once. On its next call the Device shows a notice that it was revoked and wipes what the app stored in the browser. Any session from a revoked Device is refused. The list shows last use and last user.

**Verified:**
- 378 tests green (auth 27, domain 144), plus typecheck and the tenant SQL lint.
- Browser walkthrough 12/12: enrol by QR, first PIN changed, normal browser refused, lockout logged with Device, revoked Device shows the wipe notice.

**Review fixes applied:**
- Device revoke and allowed-users edits are scoped to the property.
- Enrolment checks that the people named belong to the tenant; a guest device has none.
- Allowed users are replaced in one transaction.
- The idle lock is enforced on the server too.
- The forced PIN change applies to every signed-in page.
- Supervisors cannot reach people with roles elsewhere.
- The QR link is built from the configured domain, not request headers.
- Own-PIN change allowed only when due.
- The event list is limited to the viewer's people.
- Service roles added (glossary: "floor and service roles").

**Open points:**
- "Keeps unsent offline changes under that user" waits for offline (ticket 35). The wipe notice currently clears all browser storage; ticket 35 must keep a revoked Device's unsent changes in mind.
- A guest kiosk's token cookie lasts 400 days and is renewed only by PIN Sign-in; guest flows must renew it when they come.
- The lock screen tells whether a person is locked or has no PIN yet, and anyone holding a Device can lock the people listed on it by guessing. Both are accepted for shared floor devices.
- Some action messages are English only, as elsewhere in the app.

