---
status: accepted
---

# Guests access the portal through per-reservation links, not accounts

The guest portal is reached through a signed Portal Link tied to one reservation or booking (with a confirmation-number-plus-OTP fallback), not through a guest account with a password. We chose this over accounts because most hotel guests stay once, an account creation step reduces pre-check-in completion, and it keeps Guest profiles (a staff-side CRM concept) decoupled from authentication. Loyalty or cross-stay history for guests would need accounts and is deliberately outside v1.
