# 39 — Email delivery, templates, automatic messages and staff alerts

**What to build:** The system sends the automatic guest messages of the notifications model through Mailgun EU: confirmations and changes, Deposit Invoice, payment receipt, final Invoice, refund and fee notices, card request, balance request, pre-arrival invitation, welcome, departure-eve, thanks; each with a fixed layout, the hotel's branding, the Legal Entity's legal footer, shipped texts in all guest languages with editable subject and blocks per language, placeholders, preview, test send and reset. Documents go at once, service messages within Sending Hours; each type once per reservation and switchable where allowed. Sender: the hotel's verified domain, else the platform domain with the hotel's name; free-mail refused. Delivery state per message, hard bounces flag the address and alert the desk for critical messages; spam complaints stop non-essential mail. Staff alerts in-app and by email per user setting, and by SMS through seven.io only to Property Manager and Owner for the urgent kinds. Placeholders exist for the Portal Link and Conversation reply address, wired in tickets 40 and 43.

**Blocked by:** 13 Worker service: jobs, schedules, live updates and webhook intake, 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** in review (PR stacked on ticket 89)

- [x] Booking confirmation goes out in the guest's language with the hotel's branding and footer
- [x] A service message triggered at 23:00 waits until Sending Hours
- [x] Hard bounce marks the address and raises a desk alert
- [x] SMS alert reaches a manager's phone for a Night Audit overdue event

## Comments

**Built**
- A new messaging package sends email through Mailgun EU and SMS through seven.io. In-memory stand-ins are used in development and tests; production refuses to run without keys.
- Automatic guest messages come from what happened: a new booking or change, cancellation, confirmed fee, Deposit Invoice and Invoice (PDF attached), payment receipt, refund, check-in, departure eve and check-out.
  - Each type goes once per reservation and trigger, in the guest's language (else the property's fallback).
  - Every message has the fixed layout: the hotel's colour and name, and the Legal Entity's legal footer.
  - Documents go at once; service messages go within Sending Hours; the departure-eve message goes at 18:00.
  - A message without an address, to a bounced address, after a spam complaint (non-essential only), or a channel booking with our confirmation switched off is kept on record as "not sent", with the reason.
- Settings → Guest messages, per property:
  - Sending Hours, fallback language and guest language, pre-arrival days, check-out time, reply-to;
  - switchable types, and our own confirmation for booking-site bookings;
  - the hotel's sending domain, checked with Mailgun;
  - texts per type and language with placeholders, preview, a test send to the user from the hotel's sender, and reset. Mandatory content cannot be removed.
- Sender: from the hotel's verified domain, sent through it so the signature matches. Otherwise from the platform domain under the hotel's name.
  - Free mail and the platform's own domain are refused.
  - A domain belongs to one tenant (`control.sender_domains`).
- The reservation shows its messages with delivery state; the desk can send the confirmation again.
- Delivery events (signed Mailgun webhooks; the signed token guards against replays):
  - delivered → shown;
  - a hard bounce flags the address and notifies the property's desk for critical messages;
  - a spam complaint stops non-essential mail to that address.
- Staff Notifications: in the app always; by email per the user's setting; urgent kinds by SMS to Property Managers (Owner and Tenant Admin count as one) who gave a phone. These go through it: Night Audit overdue, outage, bounced email, Approval requests and decisions, Card Hold expiring.
- Worker: every minute per tenant, the scan and the dispatch of guest messages, staff mail and SMS. Each row is claimed once (no double sending); temporary failures retry with a pause, inside Sending Hours.

**Verified**
- Domain tests: rendering and escaping, Sending Hours and evening timing, mandatory placeholders, sendable types, who gets SMS.
- DB tests:
  - confirmation in the guest's language with look and footer, sent once, delivered;
  - welcome at 23:00 waits until 08:00;
  - hard bounce flags and suppresses later mail;
  - no-address and switched-off types;
  - channel confirmation switch;
  - text edit, mandatory content and reset;
  - sender domain: free mail, the platform domain and another tenant refused;
  - SMS outbox.
- Mailgun signing and EU endpoint, sending through the hotel's domain; seven.io.
- Worker: a Night Audit overdue SMS reaches the manager's phone, not the desk's; email per setting.
- All packages typecheck and pass.
- Walkthrough (27/27):
  - settings saved; free mail and the platform domain refused; texts edited, previewed, test-sent and reset;
  - a new booking's confirmation sent in English with the hotel's look; pre-arrival held for the portal;
  - confirmation re-sent by hand;
  - a signed hard bounce flags the address and notifies the desk; an unsigned event is refused;
  - Notification channels saved; Night Audit overdue SMS sent to the manager only.

**Review fixes**
- **Sender domain:** a tenant could claim another hotel's verified domain or the platform's own. Domains are now registered to one tenant, and the platform's domain is refused.
- **Signature mismatch:** mail from a hotel's domain went through the platform domain, so it failed DMARC. It is now sent through the hotel's own domain.
- **Empty values:** guests would have read empty links and amounts. Messages that need the Portal Link wait for ticket 40, and the manual card and balance requests are hidden until then.
- **Double sending:** staff mail and SMS could be sent twice by overlapping runs, or after a failed status update. Rows are now claimed. The stuck-row check uses the claim time.
- **Tenant Admin:** got no SMS; now counts as a Property Manager everywhere.
- **Webhook replay:** a captured signature could be replayed with a forged body. The signed token now identifies the event. The development stand-in now needs a secret.
- **Spec gaps:**
  - mandatory content enforced;
  - channel-booking confirmation switch;
  - departure-eve in the evening with the property's check-out time;
  - retries inside Sending Hours;
  - test send from the hotel's sender;
  - a week's look-back;
  - an early "delivered" kept;
  - approvals and Card Hold notices go through staff Notifications.
- **Naming:** "alerts" renamed to staff Notifications, matching the glossary, and the glossary updated. The outage title is unchanged ("Service outage: …").

**Open points**
- **Portal Link (ticket 40):** card request, balance request, pre-arrival, departure-eve and thanks are not sent until the Guest Portal gives the link. Turn on `PORTAL_LINKS_READY` there. Automatic card requests (a failed Card Hold) and balance requests before arrival belong there too.
- **Conversations (ticket 43):** the reply address and Conversation threading come with it.
- **Not sent yet:** fiscal outage and escalated-message Notifications are sent by tickets 61 and 43.
- **Branding:** only the tenant colour and the hotel name. A logo needs file storage (ticket 36). The legal footer has no commercial register line, because the Legal Entity has no such field yet.
- **Pre-arrival and departure-eve:** only go to bookings made after messaging started at a property (no flood of old bookings).
- **Test Mode:** bookings in Test Mode also send guest mail. Owner decision: hold them back?
- **Outage email:** before this ticket every manager got it. It now respects the user's email setting.
- **Owner setup:** Mailgun EU, seven.io (Austrian sender name registration from 1 October 2026), and ClamAV/S3 keys to come.
