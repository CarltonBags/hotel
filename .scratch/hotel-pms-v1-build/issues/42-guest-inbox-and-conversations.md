# 42 — Guest Inbox and Conversations

**What to build:** One Conversation per Reservation (per Booking for the Booker), with earlier stays of the guest visible read-only and collapsed. Guests write in the Portal and are emailed on each staff message; automated messages appear in the thread marked as such. The staff Guest Inbox for Front Desk and Property Manager: conversation list with unread badges, waiting time, claim ("handled by"), typing indicator, quick replies per property and language with placeholders, Internal Notes, images and PDF up to 10 MB both ways through tenant file storage, navbar badge, toast, per-user sound, escalation to the Property Manager after the property's time (default 15 minutes), Desk Hours auto-reply once per night with the timer paused.

**Blocked by:** 39 Email delivery, templates, automatic messages and staff alerts, 40 Guest Portal with Portal Link and Pre-check-in

**Status:** in review (PR stacked on ticket 41)

- [x] Unread clears only when a staff member opens the latest guest message
- [x] Escalation fires after 15 minutes during Desk Hours and not outside them
- [x] Attachment over 10 MB is refused; a PDF is viewable by staff and guest
- [x] Two staff members see each other's typing and claim state live

## Comments

**Built**
- **Conversations:** one per Reservation, one per Booking for the Booker of several rooms (their booking link), made on first use. A Message is from the guest, a staff member or automatic; an Internal Note sits in the thread and never reaches the guest.
- **Guest side:** a Messages section in the Guest Portal (stay and booking link). Guests write with an image or PDF up to 10 MB (type-checked, virus-scanned, in tenant file storage). The page fetches new answers while open. Each staff answer emails the guest with the Portal Link (`inbox_reply`); the automatic messages of the stay show in the thread, marked as such.
- **Staff Guest Inbox** (Front Desk and Property Manager of the property in view, where the Guest Portal Module is on):
  - list: unread first, waiting time since the first unanswered guest message, "handled by";
  - thread: earlier stays of the guest at this property, read-only and collapsed; claim and let go; Internal Notes; Quick Replies per property and language with placeholders (`{firstName} {lastName} {room} {arrival} {departure} {checkInTime} {checkOutTime} {property}`); attachments both ways;
  - live: typing and claim state between colleagues, the list and navbar badge refresh, a toast with the first line, an optional sound per user (account settings);
  - a "Conversation" button on the reservation.
- **Unread:** clears only when a staff member has the latest guest message in front of them (the page visible) or answers what was on screen; a message that came in meanwhile stays unread and waiting.
- **Escalation:** an unopened guest message goes to the Property Manager (Notification, email per their setting) after the property's time, default 15 minutes, counted in Desk Hours only; once per unread message; a failed notice is due again.
- **Desk Hours:** outside them the guest gets one automatic reply a night (`desk_closed`, switchable, with the desk's opening time and the emergency number) and the timer pauses.
- **Settings** (Guest messages): Desk Hours, check-in time, emergency number, escalation time, Quick Replies.

**Verified**
- All packages typecheck and pass; db `conversations.test.ts` (unread with a message arriving meanwhile, answers and notes, earlier stays from this property only, another property refused, escalation in and outside Desk Hours, one automatic reply a night, files up to 10 MB both ways), domain Desk Hours and placeholders.
- Walkthrough 21/21 with two staff browsers and a guest: settings and a Quick Reply; the guest writes with a PDF and opens it; badge; unread for the desk; unread clears when the manager opens it and the desk's list updates live; staff open the PDF; typing and claim seen live; Quick Reply filled; answer emailed with the link; the guest never sees the note; toast; a file over 10 MB refused; escalation in Desk Hours; one automatic reply with the emergency number outside them and no escalation.

**Review fixes**
- **Cross-property leak:** earlier stays came from every property of the tenant (with Internal Notes); now this property only. Every staff operation is scoped to the property.
- **Unread races:** seen and answered are decided under the Conversation's lock and only up to the guest message on screen; a background tab no longer clears unread.
- **Uploads before the link check:** the Portal Link and the hourly limit are checked before a guest's file is stored; unsent uploads are capped per property.
- **Booker's messages:** the night's reply and staff answers belong to their Conversation (`guest_messages.conversation_id`), greet the Booker, and no longer appear in a room guest's thread; the Booker's thread shows the booking's messages to them.
- **Unsent mail:** guests see only what was sent; staff see unsent automatic messages marked.
- **Typing:** addressed to the property's inbox users only; live-update hints pruned after a day.
- **Badge:** the property in view only (several properties come with ticket 43); refreshes only for its property.
- **Smaller:** times kept in the database's precision; the guest named from the stay as it is now; a file over the limit refused in the browser; check-in time and formatted dates for Quick Replies; reservation button through the form helper; language check on Quick Replies; German wording avoids "Rezeptionszeiten"; one audio context; shared SQL for the guest's name and the owner column.
- **Proxy body limit:** raised to 11 MB like server actions, so a file just over 10 MB is refused cleanly instead of arriving cut off.

**Open points**
- **Module:** the inbox shows where the Guest Portal Module is on; in dev Berlin had it off (the walkthrough switches it on).
- **Additions beyond the text:** 30 guest messages an hour per link, escalation time 5–240 minutes, GIF as an image type, the reservation's Conversation button.
- **Ticket 43:** reply by email, message to task, combined inbox across properties, retention.
