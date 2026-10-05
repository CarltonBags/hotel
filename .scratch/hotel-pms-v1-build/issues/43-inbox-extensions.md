# 43 — Inbox extensions: reply by email, message to task, combined inbox, retention

**What to build:** Notification emails carry a reply address unique to the Conversation; a guest's email reply (Mailgun inbound, stripped text, raw kept, auto-replies detected) lands in the thread with attachments. Staff turn a message into a Housekeeping Task or Maintenance Issue for the guest's room in one click, linked back. With "All properties" selected the inbox lists conversations of every accessible property labelled by hotel, with the badge counting across the scope. Conversations and attachments are deleted 12 months after departure (property may shorten), except those marked as relevant to a dispute.

**Blocked by:** 42 Guest Inbox and Conversations, 36 Maintenance Issues and tenant file storage

**Status:** in review (PR stacked on ticket 42)

- [x] Email reply with an image appears in the right Conversation
- [x] Out-of-office auto-reply is not counted as a guest message
- [x] Message to task creates the Maintenance Issue with the room and a link back
- [x] Retention job deletes a 13-month-old Conversation and keeps a disputed one

## Comments

**Built**
- **Reply by email:**
  - Messages a guest may answer (confirmation, requests, pre-arrival, welcome, departure eve, thanks, staff answers, the off-hours reply) carry their Conversation's reply address `<tenant>.<token>@MAIL_INBOUND_DOMAIN` (random 128-bit token per Conversation). Documents and codes keep the property's Reply-to.
  - Mailgun inbound route with store-and-notify: the signed notice comes to the worker's webhook intake (urlencoded or multipart), keyed by its signed token. The tenant is found by the address's slug and the domain is checked.
  - Kept: the notice and the mail as sent (MIME up to 25 MB) in `inbound_mails`; the guest's text then leaves the stored webhook event.
  - Out-of-office and other automatic replies (Auto-Submitted, X-Autoreply, Precedence, typical subjects) are kept, not counted.
  - Otherwise the stripped text and the attachments (images and PDFs up to 10 MB, fetched from Mailgun storage with a cap, virus-scanned) land in the thread as the guest's message, marked "by email"; one message per further attachment. Same guards as the portal: the link's window and 30 messages an hour. The inbox gets the live update and toast.
- **Message to task:** on a guest message, "→ Maintenance Issue" (for the guest's room, urgency today, the message as note) or "→ Housekeeping Task" (the room's hand-made task of the Business Date takes the request and opens again if done). Each linked both ways: the thread shows it made and deep-links to it; the issue and the task link to the Conversation. With several rooms (a Booker's Conversation) staff pick the room.
- **Combined inbox:** with "All properties" the inbox lists every property where the user works the inbox and the Guest Portal Module is on, each Conversation labelled by hotel and timed in its clock; the badge counts the same scope.
- **Retention:** each night Conversations whose stay ended more than the property's months ago (12, settable 1–12) go with their messages, received mails and automatic copies; their files are deleted from storage the same night. The Property Manager keeps one for a dispute (and releases it). Mails that found no Conversation go after 30 days.

**Verified**
- All packages typecheck and pass: domain (reply address, automatic replies, retention dates), messaging (Mailgun notice signature, replay key, fields), db `conversations.test.ts` (reply address on messages, email reply with an image, the same mail once, out-of-office not counted, issue and task from a message with links, a done task opened again by a second request, retention deleting a 13-month-old Conversation and keeping a disputed one).
- Walkthrough 12/12 against the dev worker with the stand-in mail provider: reply address on the staff message; the notice taken; the reply with its image in the thread, marked by email; out-of-office kept, not counted; the notice's text cleared; Maintenance Issue made for the guest's room, linked back; kept for a dispute; combined inbox labelled by hotel and opening a Conversation.

**Review fixes**
- **Forged or replayed notices:** the intake keys on the signed token, not the unsigned Message-Id; the stand-in's secret moved to a header (headers are redacted when stored).
- **Retention leak:** the guest's mail no longer stays in the stored webhook event after it is taken.
- **Housekeeping requests:** a done task opens again; each message is linked on its own (no lost links, no repeated notes); minutes from the defaults.
- **Lost or doubled work in the worker:** a permanently refused attachment no longer fails the whole mail; notifying is best effort after the commit; a notice delivered again is recognised before attachments are fetched.
- **Unbounded downloads:** attachments and the raw mail are read with a size cap.
- **Email past the portal's guards:** the link's window and the hourly limit apply.
- **Reply address on documents:** invoices, receipts, codes and invitations keep the property's Reply-to (the Booker's code mail no longer points into a room guest's thread).
- **Combined inbox:** only where the Guest Portal Module is on, each hotel's own clock.
- **Raw kept:** the mail itself (MIME) is stored, not only the notice.
- **Smaller:** dispute toggle for the Property Manager only (a legal hold); the reply address parsed anchored with its domain checked; the same mail to two Conversations taken for each; Exchange's X-Auto-Response-Suppress no longer counted as an automatic reply; links to the exact issue or task; the issue's link set when it is reported; typed task kinds; dead code removed.

**Open points**
- **Owner:** `MAIL_INBOUND_DOMAIN` (MX to Mailgun), a Mailgun inbound route for it with `store(notify="<WORKER_PUBLIC_URL>/webhooks/mail-inbound")`, the Mailgun keys. Whether Mailgun posts the notice urlencoded or multipart: both are read; to be checked against a real route.
- **Dispute marking:** whole Conversations are kept (the decision speaks of messages); kept until a Property Manager releases it.
- **Housekeeping requests:** inbox staff (Front Desk) may add them, as the inbox's own action; they join the room's hand-made "Extra clean" task of the day.
- **Guest erasure:** no erasure of guest data exists yet; when it comes it must delete the guest's Conversations.
- **Mails without a Conversation:** kept 30 days, not shown to staff.
