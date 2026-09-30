---
status: accepted
---

# Charges store gross amounts; net and VAT are derived

Every charge stores its gross amount and a tax code, and net and VAT are computed from them. We chose gross over net because hotel prices in the EU are advertised and agreed as consumer prices including VAT, and deriving gross from net produces rounding differences against the advertised price. Company invoices still display net plus VAT.
