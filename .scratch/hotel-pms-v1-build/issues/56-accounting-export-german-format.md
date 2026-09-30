# 56 — Accounting export in the German format and neutral CSV

**What to build:** Accounting selects a Legal Entity and a range of closed Business Dates, previews the booking lines and downloads the German advisor booking-batch file plus a neutral CSV with the same content, following the final mapping of gate 4: invoices, deposit and cancellation invoices as lines per revenue account and tax rate against the debtor (own debtor per on-account Company, one collective account for guests), payments per Tender to clearing accounts, liabilities for deposits and vouchers, cash desk lines from the Cash Book; a mapping table editable by Accounting; the export refuses to run while any used item lacks an account; finalising marks the period exported and locked, later corrections fall into the next period; a document package with every invoice and Paid-out receipt photo. Internally every line carries net, tax and gross.

**Blocked by:** 29 Cancellation Invoice, Receivables and reminder letters, 50 Cash desk: Cash Registers, Shifts, Cash Book, Paid-outs and Receipts, 53 Vouchers at the desk, 04 Gate: finalise the accounting export mapping

**Status:** ready-for-agent

- [ ] Export refuses while a Service has no account
- [ ] Finalised period downloads again byte-identical
- [ ] Lines balance: debit equals credit per document
- [ ] Format checked against the specification confirmed in gate 4
