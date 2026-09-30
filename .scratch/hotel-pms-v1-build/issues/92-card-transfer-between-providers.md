# 92 — Card transfer between providers

**What to build:** If gate 9 confirms it, the onboarding plan starts the card transfer about two months before the switching day with a cut-off date; imported reservations carry the old provider's reference; transferred cards secure a Card Guarantee in state "Transferred, not yet verified" until first successful use; cards stored after the cut-off are asked again through the Portal.

**Blocked by:** 90 Data import: reservations, guests, companies and open money, 09 Gate: card provider confirms card import into connected accounts

**Status:** ready-for-agent

- [ ] Transferred token attached to the right reservation by reference
- [ ] State moves to verified on first successful charge
- [ ] Reservations after the cut-off get the Portal request
