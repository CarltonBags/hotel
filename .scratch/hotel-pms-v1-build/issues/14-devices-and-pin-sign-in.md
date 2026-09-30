# 14 — Devices and PIN Sign-in

**What to build:** A Property Manager enrols a shared phone or tablet as a Device of the property by scanning a QR code from the staff app and chooses which users may sign in on it; a staff member's own phone can be enrolled for one user. On an enrolled Device, floor and service roles tap their name and enter a 4 to 6 digit PIN; simple PINs are refused; five wrong tries lock the user everywhere until a supervisor or manager resets the PIN; the device locks after 2 minutes idle (property sets 1 to 10); a new sign-in ends the previous session but keeps its unsent offline changes under that user. Users without email are created with a name and a first PIN and must change it at first sign-in. The Housekeeping Supervisor may create Housekeeper users, reset their PIN and unlock them. Revoking a Device ends its sessions and wipes stored data at next contact; the device list shows last use and last user. Tablets and kiosks for guest flows are enrolled the same way with a long-lived device token and no staff login.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages

**Status:** ready-for-agent

- [ ] PIN works only on an enrolled Device; the same PIN from a normal browser is refused
- [ ] Front Desk and other full-credential roles cannot use PIN Sign-in
- [ ] Lockout after five wrong tries is logged with device and time
- [ ] Revoked Device cannot reach the service and shows a wipe notice
