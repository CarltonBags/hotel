# Fiscal service provider selection

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

"Cash handling and fiscal cash-register obligations" puts cash and vouchers into v1 behind one fiscal module from a cloud provider, for Germany (certified technical security device under AO §146a and KassenSichV) and Austria (RKSV signing of every receipt). Compare providers that offer both through an API usable from a multi-tenant web application with no hardware at the hotel: fiskaly (SIGN DE, SIGN AT, DSFinV-K), Deutsche Fiskal / Swissbit cloud TSE, efsta, A-Trust, and any other with public documentation. Report from primary sources: certification status of each cloud security device (BSI certificate number and validity), the operating environment conditions the certificate imposes on the customer's side, API model and latency, how one platform account serves many taxpayers and registers, pricing per register or transaction, German cash data export (DSFinV-K) and Austrian data collection log support, start and year-end receipts in Austria and registration with FinanzOnline, registration data for the German tax office notification, mandatory receipt contents in both countries, and the legal rules for outages (what may continue, what receipts must state, when the tax office must be told). Also state what Switzerland requires, if anything. Recommend one provider and list the constraints on the cash, receipt and voucher model.

## Answer

Resolved 2026-09-28 by research. Findings: [fiscal-service-provider-selection.md](../../../docs/research/fiscal-service-provider-selection.md).

- **Recommendation**: fiskaly (SIGN DE, DSFINVK DE, SUBMIT DE, SIGN AT). Fallback: efsta Cloud EFR. Keep the fiscal module behind an internal interface so the provider can be changed per country.
- **Why**: only provider with a BSI-certified cloud security device that needs nothing on the customer side (BSI-K-TR-0717-2025, valid to 30.03.2033, conditional on an infrastructure certificate valid to 24.05.2027) and an Austrian service under the same account. Deutsche Fiskal needs a local component and now belongs to fiskaly; Swissbit Cloud-TSE 2 is Germany only; A-Trust is Austria only.
- **Against**: no public price; incident of 24 to 27 May 2026 left some devices defective and needing replacement; data held only three months, so the PMS must export and archive on a schedule.
- **Differs from the decision in "Cash handling and fiscal cash-register obligations"**: Germany signs every desk process that ends in a receipt, whatever the tender, not only cash and vouchers (tax advisor to confirm a narrower scope). Austria signs only payments made on site; online and guest-not-present card charges are not cash turnover. Germany has no duty to report outages to the tax office; Austria has (over 48 hours, within one week, through FinanzOnline).
- **Key constraints**: register serial numbers are immutable and vendor-assigned; one German register per device; one Austrian signature unit per Legal Entity; a daily register closing per German register; Austrian monthly and yearly receipts triggered by the PMS, yearly receipt printed and checked by 15 February; from 1 October 2026 Austrian receipts may be electronic but must be printed on request, so every Austrian desk needs a printer; corrections only by cancellation receipts; signing calls idempotent with a 3 to 5 second timeout and an outage path.
- **Switzerland**: no signing or registration duty found; cash book and immutable audit log suffice.
- **Open**: fiskaly price units (quotation needed); five questions for the tax advisor or provider are listed at the end of the findings.
