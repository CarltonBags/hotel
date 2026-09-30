# Guest inbox and messaging model

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 09

## Question

Define Conversation and Message between a reservation's guests and the property. Decide: one conversation per reservation or per guest profile (a returning guest's history), which staff roles see the Guest Inbox and whether it is per property or across the tenant, unread and assignment semantics (who is handling), templates and quick replies, automated messages (confirmation, pre-arrival, balance due) appearing in the same thread or not, attachments, retention, and how the inbox surfaces inside the app shell (persistent badge, dedicated tab, notification sound). Guest transport is email notification with portal link in v1; keep the model open for WhatsApp/SMS later.

## Answer

Resolved 2026-09-28 by grilling.

**Conversation**
- One Conversation per Reservation. The Booker of a Booking with several rooms has one Conversation for the Booking.
- Staff opening a Conversation also see the guest's conversations from earlier stays, read-only and collapsed.
- A **Message** has a sender kind: guest, staff (named user) or automatic; a time; text; optional attachments. An **Internal Note** sits in the same thread and is never shown to the guest.

**Guest Inbox**
- Shared by Front Desk and Property Manager of the property. **Always per property**: it follows the selected property and has no combined view across properties (owner's choice).
- Unread means no staff member has opened the latest guest message.
- A user may claim a Conversation ("handled by"); others still see it and may answer. A typing indicator shows when a colleague is writing. The waiting time since the last unanswered guest message is shown.

**Automated messages** appear in the same thread, visibly marked: booking confirmation, pre-arrival invitation, balance due, room ready, post-stay thanks, and the off-hours reply. The property edits the texts per language and switches each type on or off. The guest may reply to any of them.

**Guest transport**: email notification with Portal Link. **A reply by email is accepted**: notification emails carry a reply address unique to the Conversation, and the reply text and attachments are added to the thread. The model stays open for other transports (fog).

**Staff tools in v1**: quick replies per property and language with placeholders (guest name, room, check-in time); Internal Notes. **Not in v1**: translation (dropped by the owner), turning a message into a task.

**Attachments**: images and PDF in both directions, at most 10 MB each, virus-scanned, stored in the tenant's file storage, deleted with the Conversation.

**Alerting**: unread count on the Guest Inbox button in the navbar; a toast with the first line wherever the user is; sound as a per-user setting. If nobody opens a guest message within a property-set time, default 15 minutes, the Property Manager is notified.

**Desk hours**: the property sets desk hours and an emergency phone number. Outside desk hours the guest receives an automatic reply once per Conversation per night, and the escalation timer pauses until the desk opens.

**Retention**: Conversations and attachments are deleted 12 months after departure; the property may shorten this. Messages marked as relevant to a dispute are kept until the dispute is closed. Erasure of guest data removes the guest's Conversations.

> Update 2026-09-29 from "Email, SMS and WhatsApp delivery providers": WhatsApp permits free text only within 24 hours after the guest's last message and otherwise only templates approved in advance per language; a WhatsApp thread belongs to a phone number, not to a reservation; its images are capped at 5 MB. These conflict with property-edited automatic texts, the one-Conversation-per-reservation rule and the 10 MB limit if WhatsApp becomes a transport. To be settled in "Guest messaging extensions".

> Update 2026-09-29 from "Notifications model": "room ready" is not among the automatic messages in v1. Guests are notified of new messages by email only; SMS to guests is not in v1.

> Update 2026-09-29 from "Guest messaging extensions": WhatsApp is a transport in v1 as a Module per property; an Unassigned section holds messages not yet matched to a reservation; a message can become a Housekeeping Task or Maintenance Issue; the owner reversed "always per property": with "All properties" selected the inbox is combined across properties.
