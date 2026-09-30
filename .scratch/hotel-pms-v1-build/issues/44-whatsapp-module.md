# 44 — WhatsApp Module

**What to build:** A property switches on the WhatsApp Module and connects its own Meta business account and number through embedded signup (coexistence for an existing number), with the platform owner as the technical provider. Messaging Consent per guest and transport recorded with time, source and wording; the composer shows whether the 24-hour window is open and otherwise offers approved templates or email; service messages go by WhatsApp for opted-in guests as approved templates, documents stay email, never both transports for one message, email as fallback. Templates ship as standard, are submitted for approval per property and language, and show their review state; edits go back to review. Incoming messages match by phone number to the current or next reservation, else land in an Unassigned section for staff to link. Media up to 5 MB stored like other attachments; the composer warns against requesting card, bank or identity data. Usage metered per message for billing.

**Blocked by:** 43 Inbox extensions: reply by email, message to task, combined inbox, retention

**Status:** ready-for-agent

- [ ] Template message sent outside the window; free text refused outside the window
- [ ] Unknown number lands in Unassigned and can be linked to a reservation
- [ ] Consent withdrawal stops WhatsApp only; email continues
- [ ] Usage counter per property per month matches Meta's count in a test
