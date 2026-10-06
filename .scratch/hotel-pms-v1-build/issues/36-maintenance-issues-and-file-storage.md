# 36 — Maintenance Issues and tenant file storage

**What to build:** Anyone reports a Maintenance Issue for a room or public area with photo and urgency; Maintenance works the queue (open, in progress, done) with photo and note; the reporter is notified; an issue may carry a Room Block, and fixing asks whether to end the block, which sets the room Dirty. This ticket introduces the tenant file storage used by later tickets: EU S3-compatible bucket, per-tenant prefix, server-side encryption, short-lived signed URLs, virus scan on upload, retention enforced by scheduled jobs.

**Blocked by:** 33 Room state, Room Blocks and the room picker, 35 Housekeeper and Maintenance phone view, offline and ten languages

**Status:** in review (PR stacked on ticket 39)

- [x] Photo upload from the phone lands in the tenant prefix and is served only through a signed URL
- [x] Fixing an issue with a Room Block offers to end it and the room turns Dirty
- [x] A user of tenant B cannot fetch tenant A's file even with the key
- [x] Retention job deletes files past their date

## Comments

**Built**
- **File storage (new storage package):** an EU S3-compatible bucket in production, a local directory in development.
  - Requests are signed with S3 Signature V4; every object is stored with server-side encryption.
  - Keys are made only by the app: `<tenant id>/<kind>/<file id>`.
  - Uploads are checked for type (photos), size (10 MB) and content signature, then virus-scanned with ClamAV (a stand-in in development). Production refuses to start without bucket and scanner.
- **Signed links:** files are handed out only through a link bound to tenant and user, valid five minutes. The file route checks the session and the user's right to the file. It then sends the bytes, or the bucket's own one-minute presigned URL.
- **Retention:** every file has a deletion day.
  - An upload nothing takes up goes after two days.
  - Maintenance photos go a year after the fix.
  - The daily job deletes files past their day, and empties a deleted tenant's bucket prefix once (recorded on the deletion).
- **Maintenance Issues:**
  - Anyone with the right reports a room or public area with photo and urgency. Whoever may set a Room Block can take the room out in the same report.
  - Maintenance takes and fixes with a note and photo.
  - Fixing an issue whose block is not over asks whether to end it; ending it leaves the room Dirty. The decision is recorded.
  - The reporter is notified.
- **Desk page `/maintenance`:** report form, open and fixed queues, photos before and after.
- **Phone view:** photos go to file storage. "Fixed" asks for a note, a photo and, with a block, end or keep.

**Verified**
- Storage: Signature V4 equal to the AWS worked example; encrypted put; prefix deletion; local store refuses keys outside its root; EICAR test file found.
- DB tests:
  - virus, wrong type and renamed files refused; the key carries the tenant prefix; tenant B never finds tenant A's file;
  - report with block, only by who may block; someone else's upload cannot be attached;
  - fix with the block ended → room Dirty, reporter named;
  - retention by day; a deleted tenant's files removed once;
  - phone report with a stored photo.
- Signed links: expiry, and binding to tenant, user and file.
- All packages typecheck and pass.
- Walkthrough (17/17):
  - infected upload refused; report with photo and Out of Order block; file under the tenant prefix;
  - photo through a signed link; tampered and unsigned links refused (403);
  - tenant B with its own valid link for tenant A's file id: 404; tenant A's link from a tenant B session opens nothing;
  - take and fix with block ended → room Dirty, reporter notified, both photos shown;
  - retention removed the files and the references.

**Review fixes**
- **Phone reports lost:** a report or fix sent from the phone while scanning or storage was briefly down was refused and lost. The phone now keeps the batch and sends it again (503). A photo refused for what it is (virus, type) no longer loses the report: it is kept without the photo, and the phone is told.
- **Block mismatch:** the phone and the server disagreed on which blocks to ask about. Both now use "not over" (in force or still to begin).
- **Deleted tenants:** their files stayed in the bucket; the daily job now empties their prefix.
- **Rights before storing:** phone photos are stored only for someone who may report or fix, and only for a report or a fix.
- **Retention job:** one failing file no longer stops the others.
- **Cleanup:**
  - PDF uploads removed (photos only for now);
  - the shared block predicate and the fix input type named;
  - Room Block kinds from the domain;
  - English text moved out of SQL;
  - stray braces and an orphaned doc comment fixed;
  - photo decoding and store-plus-scanner shared.

**Open points**
- **Phone reports and blocks:** reports from the phone carry no Room Block. Blocking stays on the desk page or the room picker.
- **Old issues:** issues reported before this ticket keep their photo in the database (still shown) and carry no block of their own, so fixing them asks nothing about blocks.
- **Lost and found:** found-item photos stay in the database; moving them to file storage can follow.
- **Owner setup:** EU bucket (provider, keys, `S3_*`), ClamAV host (`CLAMD_HOST`), and backup retention of the bucket.
- **Duplicate send:** two sends of the same phone change at the same moment can store the photo twice. The unused copy goes after two days.
