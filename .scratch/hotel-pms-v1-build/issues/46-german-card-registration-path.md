# 46 — German card registration path with strong customer authentication

**What to build:** For a foreign guest at a German property the tablet and Portal offer, beside the printed form, the card path: the guest consents and triggers a fresh card transaction with strong customer authentication on the arrival day as cardholder (hold later captured, or payment); the system stores the purpose-bound token and provider name, writes the BeherbMeldV XML record (13 fields, xsd:date), and skips the signature. Missing consent, wrong day, third-party payer, or no SCA evidence falls back to paper. The rules follow the research file as confirmed by gate 2.

**Blocked by:** 45 Meldeschein registration on the tablet, 41 Portal payments, card storage and express checkout, 02 Gate: lawyer confirms the German card registration rules

**Status:** ready-for-agent

- [ ] Prepaid stay: card path not offered, paper path shown
- [ ] Arrival-day terminal transaction with SCA completes registration and produces a valid XML file
- [ ] Token and provider name stored; card number absent everywhere
- [ ] Rules in code match the confirmed list from gate 2
