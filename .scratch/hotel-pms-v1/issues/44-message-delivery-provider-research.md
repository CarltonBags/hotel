# Email, SMS and WhatsApp delivery providers

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

Which providers should deliver the system's email, SMS and WhatsApp messages for European hotels, with data kept in the EU? Compare for email: sending from each hotel's own domain, inbound reply handling into a conversation, deliverability tools, EU data residency, pricing. For SMS: sender names per country, delivery in Germany, Austria and Switzerland, pricing. For WhatsApp: the business platform's rules (template approval, 24-hour window, opt-in), the role of solution providers, one number per property, pricing, and what a guest conversation through WhatsApp may contain. Report from primary sources, recommend providers, and list constraints on the notifications model and the Guest Inbox.

## Answer

Resolved 2026-09-29 by research. Full findings: [message-delivery-providers.md](../../../docs/research/message-delivery-providers.md).

- **Email (v1)**: Mailgun, EU region, Foundation plan or higher. Message data stays in the EU region, 1,000 sending domains, inbound replies arrive parsed (quoted text removed) by HTTP POST with 8 hours of retries. Fallback: Amazon SES Frankfurt (about ten times cheaper, isolation per tenant, but inbound is raw MIME through S3 and SNS). Postmark is out (US hosting only), Scaleway TEM is out (cannot receive mail).
- **SMS (not v1)**: seven.io (German, EU routing), Twilio as alternative. Its server location and Austrian registration service are UNVERIFIED and must be confirmed in writing.
- **WhatsApp (not v1)**: Meta Cloud API directly, the PMS vendor as Tech Provider, each hotel onboarded by Embedded Signup with its own account and number, storage region DE or CH. Fallback: 360dialog.
- **Constraint, WhatsApp window**: free text only for 24 hours after the guest's last message; otherwise only templates approved by Meta per language. Property-edited automated texts and quick replies (ticket 19) cannot be sent freely on WhatsApp. Owner decision needed.
- **Constraint, WhatsApp thread**: a thread is per guest number and hotel number, not per Reservation; incoming messages need matching and an "unassigned" place in the Guest Inbox.
- **Constraint, Austria**: from 1 October 2026 an SMS sender name is delivered only if registered with RTR per hotel, exact in upper and lower case, valid after 14 days. SMS with a sender name is one-way and carries the Portal Link.
- **Constraint, data location**: WhatsApp stores in DE or CH but may process anywhere for up to 60 minutes; Mailgun keeps account data globally. "All data stays in the EU" is not a claim once WhatsApp is on.
- **Model**: transport and delivery record per Message, sender identity per property, consent per guest and transport, limits for attachments per transport (WhatsApp images 5 MB), reply token resolved to tenant through the control schema.
- UNVERIFIED: Meta's prices for Germany, Austria and Switzerland; Mailgun's EU data centre country and inbound size limit; Brevo's data location.
