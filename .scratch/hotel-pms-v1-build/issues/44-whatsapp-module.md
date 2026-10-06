# 44 — WhatsApp Module

**What to build:** A property switches on the WhatsApp Module and connects its own Meta business account and number through embedded signup (coexistence for an existing number), with the platform owner as the technical provider. Messaging Consent per guest and transport recorded with time, source and wording; the composer shows whether the 24-hour window is open and otherwise offers approved templates or email; service messages go by WhatsApp for opted-in guests as approved templates, documents stay email, never both transports for one message, email as fallback. Templates ship as standard, are submitted for approval per property and language, and show their review state; edits go back to review. Incoming messages match by phone number to the current or next reservation, else land in an Unassigned section for staff to link. Media up to 5 MB stored like other attachments; the composer warns against requesting card, bank or identity data. Usage metered per message for billing.

**Blocked by:** 43 Inbox extensions: reply by email, message to task, combined inbox, retention

**Status:** in review (PR stacked on ticket 43)

- [x] Template message sent outside the window; free text refused outside the window
- [x] Unknown number lands in Unassigned and can be linked to a reservation
- [x] Consent withdrawal stops WhatsApp only; email continues
- [x] Usage counter per property per month matches Meta's count in a test

## Comments

**Built**
- **Provider:** Meta's Cloud API behind a WhatsApp provider interface (the platform as Tech Provider, its system user), with a stand-in for development and tests. Without Meta keys in production nothing goes by WhatsApp and email is used.
- **Connecting:** Settings → WhatsApp (Property Manager, where the Module is on). Embedded Signup either keeps the number of the hotel's WhatsApp Business app (coexistence) or connects a new number, which is registered. The code's grant is checked against the business account and number, and a number held by another customer is refused. The setup guide text is on the page; in development a test number connects.
- **Templates:** the service messages (pre-arrival, welcome, departure eve, card and balance requests) in German and English are submitted on connecting, and their review state is shown. An edit is a new version for review while the approved one keeps going out. A paused or disabled template stops WhatsApp for that message, which goes by email.
- **Messaging Consent** with time, source and wording:
  - granted by the guest in Pre-check-in, by the desk on the guest profile, or by the guest writing first from their own number;
  - withdrawn by STOP (also "Stopp", "abmelden"), the portal or the desk;
  - a withdrawal stops WhatsApp only and stands until the guest opts in again.
- **Automatic messages:** service messages go by WhatsApp as approved templates to guests who opted in. Documents stay email. Consent and Module are checked again when sending. A refusal or failure goes by email instead, never both, and once WhatsApp took a message it is not sent again.
- **Composer:**
  - within 24 hours of the guest's last WhatsApp message: free text and files up to 5 MB by WhatsApp;
  - outside them: an approved template with the stay's details, or email; free text by WhatsApp is refused;
  - a standing warning and a live check against card, bank and identity data;
  - delivery shown on each message, moving forward only.
- **Incoming:**
  - matched by number (international or as stored nationally in the property's country) to the guest's current or next stay;
  - otherwise kept Unassigned with a "link to stay" control in the inbox, moving into the thread when linked;
  - images and PDFs up to 5 MB stored like other attachments;
  - the hotel's own app messages (echoes) join the thread.
- **Usage:** each message Meta bills (a delivered template, `pricing.billable`) is counted once per property, UTC month as Meta counts, for the subscription invoice at cost plus handling. It is shown on the settings page.
- **Webhooks:** signed with the app secret; Meta's batches are split per entry and routed by number or business account. Guests' text leaves stored events once taken, and after a week in any case. Unassigned messages go after 30 days.

**Verified**
- All packages typecheck and pass: domain (window, numbers national and international, sensitive data, Meta parameters), messaging (Meta webhook parsing and signature, challenge), db `whatsapp.test.ts`:
  - templates and versions;
  - free text refused outside the window and a template sent instead;
  - a national number matched;
  - Unassigned linked;
  - STOP also for a message queued before, with email continuing, and no opt-in again by writing;
  - billed messages counted once;
  - delivery states only forward.
- Walkthrough 19/19 with the dev worker and the stand-in:
  - connect; templates submitted and approved by webhook; consent at the desk;
  - a guest's message matched; free text with the window open; the card-data warning; no email for a WhatsApp answer;
  - a card request queued and sent by WhatsApp;
  - an unknown number Unassigned and linked; STOP;
  - the hotel's app message in the thread; the billed message counted once; usage shown.

**Review fixes**
- **Number takeover:** the signup's grant is verified at Meta and numbers are claimed per customer (another customer's number refused, routing moved within the customer).
- **Usage:** counted from Meta's billing reports, not per send.
- **Withdrawal ignored for queued messages:** consent and Module are checked again at sending.
- **Double sends:** only the provider call can put a message back in the queue.
- **STOP:** withdraws for every guest with the number, also from an unmatched number; writing again does not opt back in. Consent is only taken from the guest's own number.
- **Template edits:** submitted as new versions; paused or disabled templates stop going out.
- **Free text outside the window:** refused; the "answer" template that carried free text in a parameter was dropped (not asked for, and Meta refuses line breaks in parameters); parameters are cleaned.
- **New numbers:** registered; coexistence chosen by the hotel; the hotel app's messages taken in.
- **Batched webhooks:** split per entry; unrouted personal events kept without body; stored guest text pruned after a week.
- **Retention:** Unassigned messages go after 30 days; a linked one moves into the thread.
- **Smaller:** national numbers matched in the property's country; delivery states forward only; a status arriving before its send is recorded is retried; media downloads capped while read; staff files on WhatsApp up to 5 MB; the worker starts without Meta keys; one email fallback; shared lookups.

**Open points**
- **Owner:**
  - `META_APP_ID`, `META_APP_SECRET`, `META_SYSTEM_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`;
  - `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_SIGNUP_CONFIG_ID` (the Embedded Signup configuration with the coexistence feature);
  - `WHATSAPP_MESSAGE_COST` (euro per billed message);
  - Meta's webhook to `<WORKER_PUBLIC_URL>/webhooks/whatsapp` with the fields messages, message_template_status_update and smb_message_echoes;
  - Tech Provider onboarding at Meta.
- **Untested against Meta:** the real signup and API calls (fake only so far).
- **Several current or coming stays for one number:** these go Unassigned (the decision's "several reservations"; the ticket says "current or next").
- **New-number PIN:** the two-step PIN set when registering a new number is random and not kept; the hotel can reset it in WhatsApp Manager.
