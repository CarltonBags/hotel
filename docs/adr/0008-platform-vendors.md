---
status: accepted
---

# Vercel, Neon, Drizzle and Better Auth as the platform

v1 runs on Vercel (EU region) with Neon Postgres in Frankfurt, Drizzle as the data layer and Better Auth self-hosted in our database. We chose speed of delivery and low operations effort over EU-owned infrastructure: both hosting vendors are US-owned, so customer contracts need a DPA with standard contractual clauses and the product cannot claim "hosted by a German provider" in v1. Auth is self-hosted so staff identities never leave our database and housekeeping logins carry no per-user fee.
