# Room charge interface for external tills

Version 1. For till vendors whose till charges a hotel guest's room in Hoteloftware.

The till stays the fiscal cash register for the sale. Record a room charge at the till as a transfer, not as cash turnover; in Germany this is the DSFinV-K process type `AVTransfer`. The hotel signs the guest's payment when the folio is settled at the desk.

## Connecting

The hotel's Property Manager connects the till under **Settings → External tills**. They choose "Our room charge interface" and give the till a name; the name appears on the guest's folio. Hoteloftware shows the till's key **once**. Keep it secret: it is the till's only credential. A new key replaces the old one at once.

- Base URL: `https://<hotel>.<our domain>/api/till/v1`. The settings page shows it.
- Authentication: `Authorization: Bearer hs_till_…` on every request.
- Bodies and answers are JSON (UTF-8). Amounts are in the property's currency, decimal, tax included (gross). Tax rates are in percent, for example `7` or `19`.
- Answers are never cached. Use HTTPS only.

## 1. Guest lookup

`GET /guests?term=<surname or room number>`

The answer contains only guests who are **checked in**, are not blocked for room charges, and are covered by a card or a company account. An empty `term` lists all such guests.

```http
GET /api/till/v1/guests?term=tan
Authorization: Bearer hs_till_3f…
```

```json
{
  "guests": [
    { "reservationId": "5b0c2c8e-6f1e-4f7e-9d0a-1c2b3d4e5f60", "room": "101", "lastName": "Tanaka", "firstName": "Aiko", "remainingLimit": 150.0 }
  ]
}
```

`remainingLimit` is what is left of tonight's spending limit. Tips do not count against it. A bill over the limit is refused (`over_limit`), and the guest then pays at the till.

## 2. Post a bill

`POST /charges`

| Field | | |
|---|---|---|
| `id` | required | Your unique id of this bill (idempotency key). Sending the same `id` again returns the first result and posts nothing more. |
| `reservationId` | required | From the lookup. Room number and name are search keys only. |
| `receiptNumber` | required | Your receipt number, shown on the folio. |
| `fiscalId` | optional | Your fiscal transaction id (TSE), kept with the posting. |
| `items` | `items` or `totals` | `[{ "description", "quantity", "amount", "taxRate" }]`. `amount` is the line's gross total. |
| `totals` | `items` or `totals` | Without items: `[{ "taxRate", "amount" }]`. |
| `tip` | optional | Tip, booked apart from revenue and tax. |

Example:

```http
POST /api/till/v1/charges
Authorization: Bearer hs_till_3f…
Content-Type: application/json

{
  "id": "bill-2026-10-06-4711",
  "reservationId": "5b0c2c8e-6f1e-4f7e-9d0a-1c2b3d4e5f60",
  "receiptNumber": "4711",
  "fiscalId": "TSE-1-88412",
  "items": [
    { "description": "Wiener Schnitzel", "quantity": 1, "amount": 19.5, "taxRate": 7 },
    { "description": "Pils 0,4", "quantity": 2, "amount": 9.0, "taxRate": 19 }
  ],
  "tip": 3.0
}
```

Answer `201 Created` (or `200 OK` for the same `id` again):

```json
{ "postingId": "9a1e…", "chargeIds": ["c1…", "c2…", "c3…"] }
```

On the folio this becomes one Charge per tax rate, for example "Restaurant 4711 · 7 %" (19.50) and "Restaurant 4711 · 19 %" (9.00), each with its items as detail. The tip becomes its own line, "Restaurant 4711 · Tip" (3.00).

## 3. Reverse a bill

`POST /charges/{id}/reversal`, where `{id}` is the `id` of the bill you posted. Only whole bills are reversed. To correct one item, reverse the bill and post it again.

```http
POST /api/till/v1/charges/bill-2026-10-06-4711/reversal
Authorization: Bearer hs_till_3f…
Content-Type: application/json

{ "id": "void-2026-10-06-4712", "receiptNumber": "4712", "fiscalId": "TSE-1-88420" }
```

The reversal posts the original's Charges again as negative amounts, linked to the original. A bill is reversed once. The guest must still be checked in.

## Refusals

A refused posting answers `422` with a code and a short text you can show at the till (at most 50 characters):

```json
{ "error": "not_checked_in", "message": "The guest is not checked in" }
```

| Code | Meaning |
|---|---|
| `invalid` | Missing id, no items or totals, or an amount that is not a number |
| `not_found` | No such reservation at this hotel |
| `not_checked_in` | The guest is not (or no longer) checked in. Checked-out guests are refused. |
| `blocked` | Room charges are blocked for this guest |
| `not_covered` | No card or company account covers room charges |
| `over_limit` | The bill is over the remaining spending limit |
| `unknown_tax_rate` | The hotel has not set up a Tax Code for this rate |
| `original_not_found` | The bill to reverse was not found |
| `already_reversed` | The bill is already reversed |

Other answers: `401` for a wrong or revoked key, `400` for a body that is not JSON, and `500` for an error on our side, which is safe to retry with the same `id`.

Hoteloftware keeps every refused posting, with what you sent, under **Till postings**. Staff post it by hand and mark it reconciled. Do not rely on resending a refused posting.

## Lightspeed Restaurant (K-Series)

To connect Lightspeed, the hotel chooses "Lightspeed Restaurant" in the settings and enters the venue's `businessExternalReference`. The Lightspeed partner registration (`POST /pms/v1/providers`) then sets:

- base URL `https://<hotel>.<our domain>/api/lightspeed`
- the key shown in the settings as `apiKey`

Lightspeed calls two endpoints:

- `GET {base}/search?businessExternalReference=…&apiKey=…&term=…`. The answer is `{ "reservations": [{ "reservationId", "roomId", "roomDescription", "clientName", "creditLimit", "blocked" }] }`, with checked-in guests only.
- `POST {base}/charge?apiKey=…` with the closed account and `X-Lightspeed-Idempotency-Key`. The account's `uuid` is the idempotency key. Only payments with code `IKPMS` (Charge to Room) are taken, and the whole bill must go to the room (no `PARTIAL_PAYMENTS`). A void, a new account whose `initialAccountId` points to the first, reverses the original. A refusal answers `400` with `customerErrorMessage`.

To confirm in the Lightspeed sandbox (research "Point-of-sale systems and room charge interfaces"):

- whether `amount` is gross;
- whether `taxRate` is a multiplier (we read `1.07` as 7 %);
- whether the payment amount excludes the tip;
- where the reservation id travels (we read `payments[].pmsReservationId`);
- whether the charge request carries `apiKey`.
