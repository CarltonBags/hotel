import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { VOUCHER_SALE_TENDERS, can, maskVoucherCode, normalizeVoucherCode, roundMoney, voucherBalance, voucherCode, type VoucherSaleTender } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { inTestMode } from "./go-live";
import { bookVoucherSaleIn, issueVoucherReceiptIn } from "./cash";
import type { Viewer } from "./room-state";
import { withTenant } from "./with-tenant";

/**
 * Vouchers at the desk (ticket 53): the Front Desk sells a value Voucher by
 * any tender (cash into the Cash Book, a card on the terminal or a bank
 * transfer with its reference), booked to the Legal Entity's liability
 * account, not revenue, with a Receipt (signed in Germany and Austria). The
 * code goes by email to whom it is for, a copy to the buyer. It is redeemed
 * as a Tender on a folio at any property of that Legal Entity, partly, the
 * rest staying on it; a refund of a redemption gives the value back.
 */

export interface VoucherSale {
  propertyId: string;
  amount: number;
  tender: VoucherSaleTender;
  /** A card slip's or a transfer's reference. */
  reference: string;
  buyerName: string;
  buyerEmail: string;
  recipientName: string;
  recipientEmail: string;
  message: string;
}

export interface SoldVoucher {
  id: string;
  code: string;
  receiptId: string;
  receiptToken: string;
  /** False in Test Mode: no mail leaves for anyone outside. */
  mailed: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is left on Vouchers, by id. */
async function balancesIn(tx: PoolClient, ids: string[]): Promise<Map<string, number>> {
  const rows = (await tx.query<{ id: string; amount: string; used: string }>(
    `select v.id, v.amount, coalesce((select sum(p.amount) from payments p where p.voucher_id = v.id and p.status = 'succeeded'), 0) as used from vouchers v where v.id = any($1::uuid[])`,
    [ids],
  )).rows;
  return new Map(rows.map((r) => [r.id, voucherBalance(Number(r.amount), [Number(r.used)])]));
}

/** Sell a Voucher (Front Desk): the money in, the liability booked, a Receipt, the code by email. */
export async function sellVoucher(pool: Pool, schema: string, input: VoucherSale, viewer: Viewer): Promise<SoldVoucher> {
  if (!isUuid(input.propertyId)) throw new Error("Property not found");
  if (!can(viewer.actor, "sell_vouchers", input.propertyId)) throw new Error("Not allowed to sell Vouchers");
  const amount = roundMoney(Number(input.amount));
  if (!(amount > 0) || amount > 10_000) throw new Error("A Voucher is worth more than 0 and at most 10,000");
  if (!(VOUCHER_SALE_TENDERS as readonly string[]).includes(input.tender)) throw new Error("Unknown Tender");
  const reference = input.reference.trim().slice(0, 200);
  if (input.tender !== "cash" && !reference) throw new Error("A card or transfer needs its reference");
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  const buyerEmail = input.buyerEmail.trim().toLowerCase();
  if (!EMAIL.test(recipientEmail)) throw new Error("Give the email address the Voucher goes to");
  if (buyerEmail && !EMAIL.test(buyerEmail)) throw new Error("Check the buyer's email address");
  return withTenant(pool, schema, async (tx) => {
    const p = (await tx.query<{ legal_entity_id: string; currency: string; name: string; account: string; le_name: string }>(
      "select p.legal_entity_id, trim(p.currency) as currency, p.name, le.voucher_liability_account as account, le.name as le_name from properties p join legal_entities le on le.id = p.legal_entity_id where p.id = $1",
      [input.propertyId],
    )).rows[0];
    if (!p) throw new Error("Property not found");
    if (!p.account.trim()) throw new Error("Set the Voucher liability account of the Legal Entity first (Settings → Legal Entities)");
    let id = "";
    let code = "";
    for (let attempt = 0; !id; attempt++) {
      code = voucherCode(randomBytes(12));
      id = (await tx.query<{ id: string }>(
        `insert into vouchers (legal_entity_id, property_id, code, amount, currency, tender, reference, buyer_name, buyer_email, recipient_name, recipient_email, message, sold_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict (code) do nothing returning id`,
        [p.legal_entity_id, input.propertyId, code, amount, p.currency, input.tender, reference, input.buyerName.trim().slice(0, 120), buyerEmail, input.recipientName.trim().slice(0, 120), recipientEmail, input.message.trim().slice(0, 1000), viewer.userId],
      )).rows[0]?.id ?? "";
      if (!id && attempt > 5) throw new Error("No free Voucher code; try again");
    }
    // cash comes into the user's Shift, booked to the liability account
    const registerId = input.tender === "cash" ? await bookVoucherSaleIn(tx, { id, propertyId: input.propertyId, amount, account: p.account }, viewer.userId) : null;
    const receiptId = await issueVoucherReceiptIn(tx, { id, propertyId: input.propertyId }, registerId, viewer.userId);
    const token = (await tx.query<{ token: string }>("select token from receipts where id = $1", [receiptId])).rows[0]!.token;
    // the code by email to whom it is for, a copy to the buyer
    const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: p.currency }).format(amount);
    const body = (to: string) =>
      [
        `${to ? `Hallo ${to},` : "Hallo,"}`,
        "",
        `${input.recipientName.trim() && input.buyerName.trim() ? `${input.buyerName.trim()} schenkt Ihnen` : "Hier ist"} ein Wertgutschein über ${money} für ${p.name}.`,
        input.message.trim() ? `\n„${input.message.trim()}"\n` : "",
        `Gutscheincode: ${code}`,
        `Einlösbar in allen Häusern von ${p.le_name}; ein Rest bleibt auf dem Gutschein.`,
        "",
        `A voucher worth ${money} for ${p.name}. Code: ${code}. Redeemable at every property of ${p.le_name}; what is not used stays on it.`,
      ].join("\n");
    const mails = [{ to: recipientEmail, name: input.recipientName.trim() }, ...(buyerEmail && buyerEmail !== recipientEmail ? [{ to: buyerEmail, name: input.buyerName.trim() }] : [])];
    // in Test Mode a Voucher goes with the test records at go-live: its code never leaves by mail
    const mailed = !(await inTestMode(tx));
    if (mailed) {
      for (const m of mails) {
        await tx.query("insert into mail_outbox (to_email, subject, body, property_id, voucher_id) values ($1, $2, $3, $4, $5)", [m.to, `Ihr Wertgutschein · Your voucher (${p.name})`, body(m.name), input.propertyId, id]);
      }
    }
    return { id, code, receiptId, receiptToken: token, mailed };
  });
}

/**
 * The Voucher a payment redeems, inside the payment's transaction: locked,
 * of the property's Legal Entity, with enough left. Its id.
 */
export async function redeemableVoucherIn(tx: PoolClient, propertyId: string, codeInput: string, amount: number): Promise<string> {
  const code = normalizeVoucherCode(codeInput);
  if (!code) throw new Error("Give the Voucher code (XXXX-XXXX-XXXX)");
  const v = (await tx.query<{ id: string; legal_entity_id: string; currency: string }>("select id, legal_entity_id, trim(currency) as currency from vouchers where code = $1 for update", [code])).rows[0];
  if (!v) throw new Error("No Voucher with this code");
  const p = (await tx.query<{ legal_entity_id: string; currency: string }>("select legal_entity_id, trim(currency) as currency from properties where id = $1", [propertyId])).rows[0]!;
  if (v.legal_entity_id !== p.legal_entity_id) throw new Error("This Voucher was sold by another company and cannot be redeemed here");
  if (v.currency !== p.currency) throw new Error(`This Voucher is in ${v.currency} and cannot pay a folio in ${p.currency}`);
  const left = (await balancesIn(tx, [v.id])).get(v.id)!;
  if (left <= 0) throw new Error("Nothing is left on this Voucher");
  if (amount > left) throw new Error(`Only ${left.toFixed(2)} is left on this Voucher`);
  return v.id;
}

export interface VoucherRow {
  id: string;
  code: string;
  amount: number;
  balance: number;
  currency: string;
  soldAt: Date;
  soldAtProperty: string;
  tender: string;
  recipientName: string;
  recipientEmail: string;
  buyerName: string;
}

/** Vouchers of the property's Legal Entity, newest first; `open`: only those with a balance left (Vouchers in circulation), however old. */
export async function listVouchers(pool: Pool, schema: string, propertyId: string, options: { open?: boolean } = {}): Promise<VoucherRow[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; code: string; amount: string; balance: string; currency: string; sold_at: Date; name: string; tender: string; recipient_name: string; recipient_email: string; buyer_name: string }>(
      `select v.id, v.code, v.amount, v.amount - coalesce((select sum(p.amount) from payments p where p.voucher_id = v.id and p.status = 'succeeded'), 0) as balance,
              trim(v.currency) as currency, v.sold_at, sp.name, v.tender, v.recipient_name, v.recipient_email, v.buyer_name
       from vouchers v join properties sp on sp.id = v.property_id
       where v.legal_entity_id = (select legal_entity_id from properties where id = $1)
         and (not $2 or v.amount - coalesce((select sum(p.amount) from payments p where p.voucher_id = v.id and p.status = 'succeeded'), 0) > 0)
       order by v.sold_at desc limit 500`,
      [propertyId, options.open === true],
    )).rows.map((r) => ({ id: r.id, code: r.code, amount: Number(r.amount), balance: roundMoney(Number(r.balance)), currency: r.currency, soldAt: r.sold_at, soldAtProperty: r.name, tender: r.tender, recipientName: r.recipient_name, recipientEmail: r.recipient_email, buyerName: r.buyer_name })),
  );
}

/** A Voucher as the desk looks it up by its code: what is left, and whether this property may redeem it. */
export async function voucherByCode(pool: Pool, schema: string, propertyId: string, codeInput: string): Promise<{ code: string; balance: number; currency: string; redeemableHere: boolean } | null> {
  const code = normalizeVoucherCode(codeInput);
  if (!code || !isUuid(propertyId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const v = (await tx.query<{ id: string; legal_entity_id: string; currency: string }>("select id, legal_entity_id, trim(currency) as currency from vouchers where code = $1", [code])).rows[0];
    if (!v) return null;
    const le = (await tx.query<{ legal_entity_id: string }>("select legal_entity_id from properties where id = $1", [propertyId])).rows[0]?.legal_entity_id;
    return { code: maskVoucherCode(code), balance: (await balancesIn(tx, [v.id])).get(v.id)!, currency: v.currency, redeemableHere: v.legal_entity_id === le };
  });
}

/** The Legal Entity's account Vouchers sold are booked to (a liability). */
export async function setVoucherLiabilityAccount(pool: Pool, schema: string, legalEntityId: string, account: string): Promise<void> {
  if (!isUuid(legalEntityId)) throw new Error("Legal Entity not found");
  const n = await withTenant(pool, schema, async (tx) => (await tx.query("update legal_entities set voucher_liability_account = $2 where id = $1", [legalEntityId, account.trim().slice(0, 20)])).rowCount);
  if (!n) throw new Error("Legal Entity not found");
}
