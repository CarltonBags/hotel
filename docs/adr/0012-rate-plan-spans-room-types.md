---
status: accepted
---

# A rate plan spans room types; derived prices are stored as daily values

A rate plan is defined once per property and carries a price per room type and date, instead of one rate plan per room type as channel managers model it. Each (rate plan, room type) pair is projected to the channel manager as its own external rate plan. We chose this because policies, included services and texts would otherwise be duplicated for every room type. Derived rate plans are limited to one level and their resulting daily prices are always stored, because only some channel managers can evaluate derivation rules themselves.

## Consequences

- The number of projected rate plans is rate plans times room types and must stay under the channel manager's limit per property.
- Changing a base price rewrites the stored prices of its derived plans and queues them for synchronisation.
