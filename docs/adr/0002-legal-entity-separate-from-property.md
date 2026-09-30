---
status: accepted
---

# Legal Entity is a separate concept from Property

Invoice-issuing company data (name, address, VAT ID, bank details, invoice numbering) lives on a Legal Entity owned by the tenant, and each Property belongs to exactly one Legal Entity. We chose this over putting company data on the Property because German invoice and GoBD numbering rules attach to the issuing company, and chains frequently run several hotels under one GmbH; duplicating company data per property would fragment invoice sequences and make VAT reporting wrong.
