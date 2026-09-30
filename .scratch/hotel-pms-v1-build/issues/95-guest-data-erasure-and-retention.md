# 95 — Guest data erasure and retention jobs

**What to build:** A Property Manager requests erasure of a guest; Tenant Admin or Owner executes it at tenant level: the system keeps what the law requires (invoice fields for 8 years, registration records until their deletion date) and removes the rest including Conversations and stored files; the log entry carries no erased data. Retention jobs run for every category with a date: registration records per country, Conversations, Meldeschein PDFs, document images, Night Audit reports 10 years, City Tax reports 4 years.

**Blocked by:** 45 Meldeschein registration on the tablet, 42 Guest Inbox and Conversations, 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** ready-for-agent

- [ ] Erased guest's invoices still render with name and address; profile, messages and images are gone
- [ ] Log entry contains no personal data
- [ ] Retention job report lists what was deleted per category
