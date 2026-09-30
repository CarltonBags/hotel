# 43 — Inbox extensions: reply by email, message to task, combined inbox, retention

**What to build:** Notification emails carry a reply address unique to the Conversation; a guest's email reply (Mailgun inbound, stripped text, raw kept, auto-replies detected) lands in the thread with attachments. Staff turn a message into a Housekeeping Task or Maintenance Issue for the guest's room in one click, linked back. With "All properties" selected the inbox lists conversations of every accessible property labelled by hotel, with the badge counting across the scope. Conversations and attachments are deleted 12 months after departure (property may shorten), except those marked as relevant to a dispute.

**Blocked by:** 42 Guest Inbox and Conversations, 36 Maintenance Issues and tenant file storage

**Status:** ready-for-agent

- [ ] Email reply with an image appears in the right Conversation
- [ ] Out-of-office auto-reply is not counted as a guest message
- [ ] Message to task creates the Maintenance Issue with the room and a link back
- [ ] Retention job deletes a 13-month-old Conversation and keeps a disputed one
