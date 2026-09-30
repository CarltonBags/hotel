# 36 — Maintenance Issues and tenant file storage

**What to build:** Anyone reports a Maintenance Issue for a room or public area with photo and urgency; Maintenance works the queue (open, in progress, done) with photo and note; the reporter is notified; an issue may carry a Room Block, and fixing asks whether to end the block, which sets the room Dirty. This ticket introduces the tenant file storage used by later tickets: EU S3-compatible bucket, per-tenant prefix, server-side encryption, short-lived signed URLs, virus scan on upload, retention enforced by scheduled jobs.

**Blocked by:** 33 Room state, Room Blocks and the room picker, 35 Housekeeper and Maintenance phone view, offline and ten languages

**Status:** ready-for-agent

- [ ] Photo upload from the phone lands in the tenant prefix and is served only through a signed URL
- [ ] Fixing an issue with a Room Block offers to end it and the room turns Dirty
- [ ] A user of tenant B cannot fetch tenant A's file even with the key
- [ ] Retention job deletes files past their date
