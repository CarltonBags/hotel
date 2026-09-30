# Shared-device login for floor staff

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

How do housekeepers and maintenance staff without a personal phone or email sign in? Decide: enrolment of a shared phone or tablet as a Device, sign-in by PIN, badge or QR code, how a user without email is invited and recovers access, session length and automatic sign-out, what a shared device may show, and how this fits the rule that every staff member has an individual login.

## Answer

Resolved 2026-09-29 by grilling.

**Principle kept**: every staff member has an individual login. A shared device never has a user of its own; it only lets enrolled people sign in quickly.

**Enrolment**: a Property Manager enrols a shared phone or tablet as a Device of the property (QR code from the staff app) and chooses which users may sign in on it. A staff member's own phone can be enrolled too, for that one user.

**PIN Sign-in**: on an enrolled Device the staff member taps their name or photo and enters a personal PIN of 4 to 6 digits. A PIN works only on enrolled Devices, never from an unknown phone or browser. Every action stays tied to the person. Simple PINs (1234, 0000, a birth year) are refused.

**Who may use it**: floor and service roles only: Housekeeper, Housekeeping Supervisor, Maintenance, and later point-of-sale staff. Front Desk, Accounting, Revenue and Property Manager always sign in with full credentials.

**Users without email**: email and phone are optional for roles that work on shared devices. The user is created with a name and a first PIN, and must choose a new PIN at first sign-in. Such users cannot sign in anywhere except on enrolled Devices.

**Who creates and resets**: the Property Manager for every user. The Housekeeping Supervisor may create Housekeeper users, reset their PIN and unlock them, and nothing else. This amends "Permission matrix for fixed roles", where only the Property Manager managed users.

**Wrong PIN**: after 5 wrong tries the user is locked on all devices until a supervisor or manager resets the PIN. Logged with device and time.

**Session**: the device locks after 2 minutes without touch; the property may set 1 to 10 minutes. The locked screen shows only the list of users. When another person signs in, the previous session ends; unsent offline changes of the previous user are kept and sent under that user's name.

**Lost or stolen device**: the manager revokes the Device in the device list, which shows each device with last use and last user. Revoking ends all sessions on it at once. Task data stored for offline work is encrypted and erased when the device next reaches the service; without a connection it stays unreadable without a valid PIN.

**What a shared device may show**: only what the signed-in user's role may see, which for floor roles is the Floor View.
