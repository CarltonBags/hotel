# Permissions for cash, vouchers and outlet roles

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

"Permission matrix for fixed roles" covers seven roles. Two gaps remain: (1) the cash and voucher permissions proposed by the agent in "Cash handling and fiscal cash-register obligations" were never reviewed by the owner (open and close Shift, cash payments and refunds, Paid-outs with limit, bank deposits, transfers between registers, Cash Book visibility, sell and redeem vouchers); (2) the three roles added by "Own point of sale for bar, restaurant and spa" (Service, Spa Staff, Outlet Manager) have no rows yet: tables and bills, room charge within Spending Limit, voids after an order is signed, discounts, refunds, spa appointments, outlet menus and prices, outlet reports. Also decide what Front Desk may do at an outlet and whether Revenue sets outlet prices. Write the rows into the matrix.

## Answer

Resolved 2026-09-30 by grilling. Legend as in "Permission matrix for fixed roles": ● allowed · ◐ with limits · ▲ only with Approval · blank not allowed. Columns: PM Property Manager · FD Front Desk · AC Accounting · SV Service · SP Spa Staff · OM Outlet Manager. Other roles have no rights here.

| Action | PM | FD | AC | SV | SP | OM |
|---|---|---|---|---|---|---|
| **Desk cash and vouchers** (owner accepted the earlier proposal) | | | | | | |
| Open and close a Shift at the desk | ● | ● | | | | |
| Take cash, refund cash | ● | ● | | | | |
| Sell and redeem Vouchers at the desk | ● | ● | | | | |
| Paid-out | ● | ◐ up to property limit, ▲ above | | | | |
| Bank deposit, transfer between registers | ● | | ● | | | |
| View Cash Books | ● all | ◐ own Shift | ● all | ◐ own Shift | ◐ own Shift | ◐ own outlets |
| **Outlets** | | | | | | |
| Open and close a Shift at an outlet register | ● | | | ● | ● | ● |
| Tables, orders, send to printer, split and move bills | ● | | | ● | | ● |
| Spa appointment book, spa sales | ● | | | | ● | ● own outlets |
| Take card, cash, voucher; tips | ● | | | ● | ● | ● |
| Room Charge within Spending Limit | ● | | | ● | ● | ● |
| Room Charge above limit | ● | | | ▲ | ▲ | ● |
| Discount | ● | | | ◐ up to a percentage set per outlet (owner's choice), ▲ above | ◐ same | ● |
| Void a signed order, refund | ● | | | ▲ | ▲ | ● |
| Menus, prices, printers, outlet settings | ● | | | | | ● own outlets |
| Outlet reports | ● | | ● | | | ● own outlets |
| See outlet Room Charges on folios; move or void an uninvoiced one with reason | ● | ● | ● | | | |

Approval at an outlet is given by an Outlet Manager or Property Manager on the device, as defined in the permission matrix. Revenue has no outlet rights. A user holding several roles (for example Front Desk and Service in a small hotel) gets the sum of their rights.
