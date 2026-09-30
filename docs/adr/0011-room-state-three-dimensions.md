---
status: accepted
---

# Room state is three independent dimensions, not one status code

A room carries a Cleanliness (Dirty, Clean, Inspected), an Occupancy derived from reservations, and optional dated Room Blocks (Out of Order, Out of Service). We chose this over the classic single status list (vacant clean, occupied dirty, out of order and so on) because the combined list cannot express a block planned for next week, mixes facts staff set with facts the system knows, and multiplies codes with every new state. Occupancy is never set by hand, so it cannot disagree with the reservations.
