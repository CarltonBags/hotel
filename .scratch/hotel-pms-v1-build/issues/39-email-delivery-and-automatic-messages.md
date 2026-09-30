# 39 — Email delivery, templates, automatic messages and staff alerts

**What to build:** The system sends the automatic guest messages of the notifications model through Mailgun EU: confirmations and changes, Deposit Invoice, payment receipt, final Invoice, refund and fee notices, card request, balance request, pre-arrival invitation, welcome, departure-eve, thanks; each with a fixed layout, the hotel's branding, the Legal Entity's legal footer, shipped texts in all guest languages with editable subject and blocks per language, placeholders, preview, test send and reset. Documents go at once, service messages within Sending Hours; each type once per reservation and switchable where allowed. Sender: the hotel's verified domain, else the platform domain with the hotel's name; free-mail refused. Delivery state per message, hard bounces flag the address and alert the desk for critical messages; spam complaints stop non-essential mail. Staff alerts in-app and by email per user setting, and by SMS through seven.io only to Property Manager and Owner for the urgent kinds. Placeholders exist for the Portal Link and Conversation reply address, wired in tickets 40 and 43.

**Blocked by:** 13 Worker service: jobs, schedules, live updates and webhook intake, 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** ready-for-agent

- [ ] Booking confirmation goes out in the guest's language with the hotel's branding and footer
- [ ] A service message triggered at 23:00 waits until Sending Hours
- [ ] Hard bounce marks the address and raises a desk alert
- [ ] SMS alert reaches a manager's phone for a Night Audit overdue event
