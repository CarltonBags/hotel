# 42 — Guest Inbox and Conversations

**What to build:** One Conversation per Reservation (per Booking for the Booker), with earlier stays of the guest visible read-only and collapsed. Guests write in the Portal and are emailed on each staff message; automated messages appear in the thread marked as such. The staff Guest Inbox for Front Desk and Property Manager: conversation list with unread badges, waiting time, claim ("handled by"), typing indicator, quick replies per property and language with placeholders, Internal Notes, images and PDF up to 10 MB both ways through tenant file storage, navbar badge, toast, per-user sound, escalation to the Property Manager after the property's time (default 15 minutes), Desk Hours auto-reply once per night with the timer paused.

**Blocked by:** 39 Email delivery, templates, automatic messages and staff alerts, 40 Guest Portal with Portal Link and Pre-check-in

**Status:** ready-for-agent

- [ ] Unread clears only when a staff member opens the latest guest message
- [ ] Escalation fires after 15 minutes during Desk Hours and not outside them
- [ ] Attachment over 10 MB is refused; a PDF is viewable by staff and guest
- [ ] Two staff members see each other's typing and claim state live
