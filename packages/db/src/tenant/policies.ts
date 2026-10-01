import type { Pool } from "pg";
import { FEE_KINDS, PAYMENT_KINDS, isOneOf, roundMoney, type FeeKind, type PaymentKind } from "@hoteloftware/domain";
import { uniqueViolation } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/** Reusable per property ("Rates and restrictions model": policies are reusable objects). */
export interface PaymentPolicyInput {
  propertyId: string;
  name: string;
  kind: PaymentKind;
  /** Required for kind "deposit_percent". */
  depositPercent?: number | undefined;
}
export interface PaymentPolicy extends Omit<PaymentPolicyInput, "depositPercent"> {
  id: string;
  depositPercent: number | null;
}

export interface CancellationPolicyInput {
  propertyId: string;
  name: string;
  /** null = never free of charge. */
  freeUntilDays: number | null;
  /** HH:MM in the property's time zone. */
  freeUntilTime?: string | undefined;
  feeKind: FeeKind;
  feePercent?: number | undefined;
  noShowFeeKind: FeeKind;
  noShowFeePercent?: number | undefined;
}
export interface CancellationPolicy extends Omit<CancellationPolicyInput, "freeUntilTime" | "feePercent" | "noShowFeePercent"> {
  id: string;
  freeUntilTime: string;
  feePercent: number | null;
  noShowFeePercent: number | null;
}

function percentFor(kind: string, percentKind: string, value: number | undefined, what: string): number | null {
  if (kind !== percentKind) return null;
  if (value === undefined || !Number.isFinite(value) || value <= 0 || value > 100) throw new Error(`${what} needs a percent above 0 and at most 100`);
  return roundMoney(value);
}

function requireName(name: string): string {
  const n = name.trim();
  if (!n) throw new Error("Name is required");
  return n;
}

function checkTime(t: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error("Time must be HH:MM");
  return t;
}

interface PayRow {
  id: string;
  property_id: string;
  name: string;
  kind: PaymentKind;
  deposit_percent: string | null;
}
const toPay = (r: PayRow): PaymentPolicy => ({ id: r.id, propertyId: r.property_id, name: r.name, kind: r.kind, depositPercent: r.deposit_percent === null ? null : Number(r.deposit_percent) });

export async function createPaymentPolicy(pool: Pool, schema: string, input: PaymentPolicyInput): Promise<PaymentPolicy> {
  if (!isOneOf(PAYMENT_KINDS, input.kind)) throw new Error("Unknown payment kind");
  const name = requireName(input.name);
  const deposit = percentFor(input.kind, "deposit_percent", input.depositPercent, "A deposit");
  return withTenant(pool, schema, async (tx) => {
    try {
      const { rows } = await tx.query<PayRow>(
        "insert into payment_policies (property_id, name, kind, deposit_percent) values ($1, $2, $3, $4) returning id, property_id, name, kind, deposit_percent",
        [input.propertyId, name, input.kind, deposit],
      );
      return toPay(rows[0]!);
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Payment Policy "${name}" already exists at this property`);
      throw err;
    }
  });
}

export async function updatePaymentPolicy(pool: Pool, schema: string, propertyId: string, id: string, input: Omit<PaymentPolicyInput, "propertyId">): Promise<PaymentPolicy> {
  if (!isOneOf(PAYMENT_KINDS, input.kind)) throw new Error("Unknown payment kind");
  const name = requireName(input.name);
  const deposit = percentFor(input.kind, "deposit_percent", input.depositPercent, "A deposit");
  return withTenant(pool, schema, async (tx) => {
    try {
      const { rows } = await tx.query<PayRow>(
        "update payment_policies set name = $3, kind = $4, deposit_percent = $5 where id = $1 and property_id = $2 returning id, property_id, name, kind, deposit_percent",
        [id, propertyId, name, input.kind, deposit],
      );
      if (!rows[0]) throw new Error("Payment Policy not found");
      return toPay(rows[0]);
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Payment Policy "${name}" already exists at this property`);
      throw err;
    }
  });
}

export async function listPaymentPolicies(pool: Pool, schema: string, propertyId: string): Promise<PaymentPolicy[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<PayRow>("select id, property_id, name, kind, deposit_percent from payment_policies where property_id = $1 order by name", [propertyId]);
    return rows.map(toPay);
  });
}

interface CxlRow {
  id: string;
  property_id: string;
  name: string;
  free_until_days: number | null;
  free_until_time: string;
  fee_kind: FeeKind;
  fee_percent: string | null;
  no_show_fee_kind: FeeKind;
  no_show_fee_percent: string | null;
}
const CXL_COLS = "id, property_id, name, free_until_days, to_char(free_until_time, 'HH24:MI') as free_until_time, fee_kind, fee_percent, no_show_fee_kind, no_show_fee_percent";
const toCxl = (r: CxlRow): CancellationPolicy => ({
  id: r.id,
  propertyId: r.property_id,
  name: r.name,
  freeUntilDays: r.free_until_days,
  freeUntilTime: r.free_until_time,
  feeKind: r.fee_kind,
  feePercent: r.fee_percent === null ? null : Number(r.fee_percent),
  noShowFeeKind: r.no_show_fee_kind,
  noShowFeePercent: r.no_show_fee_percent === null ? null : Number(r.no_show_fee_percent),
});

function cxlValues(input: Omit<CancellationPolicyInput, "propertyId">) {
  if (!isOneOf(FEE_KINDS, input.feeKind) || !isOneOf(FEE_KINDS, input.noShowFeeKind)) throw new Error("Unknown fee kind");
  if (input.freeUntilDays !== null && (!Number.isInteger(input.freeUntilDays) || input.freeUntilDays < 0)) throw new Error("Days before arrival must be a whole number of at least 0");
  return [
    requireName(input.name),
    input.freeUntilDays,
    checkTime(input.freeUntilTime ?? "18:00"),
    input.feeKind,
    percentFor(input.feeKind, "percent", input.feePercent, "The cancellation fee"),
    input.noShowFeeKind,
    percentFor(input.noShowFeeKind, "percent", input.noShowFeePercent, "The no-show fee"),
  ] as const;
}

export async function createCancellationPolicy(pool: Pool, schema: string, input: CancellationPolicyInput): Promise<CancellationPolicy> {
  const v = cxlValues(input);
  return withTenant(pool, schema, async (tx) => {
    try {
      const { rows } = await tx.query<CxlRow>(
        `insert into cancellation_policies (property_id, name, free_until_days, free_until_time, fee_kind, fee_percent, no_show_fee_kind, no_show_fee_percent)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${CXL_COLS}`,
        [input.propertyId, ...v],
      );
      return toCxl(rows[0]!);
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Cancellation Policy "${v[0]}" already exists at this property`);
      throw err;
    }
  });
}

export async function updateCancellationPolicy(pool: Pool, schema: string, propertyId: string, id: string, input: Omit<CancellationPolicyInput, "propertyId">): Promise<CancellationPolicy> {
  const v = cxlValues(input);
  return withTenant(pool, schema, async (tx) => {
    try {
      const { rows } = await tx.query<CxlRow>(
        `update cancellation_policies set name = $3, free_until_days = $4, free_until_time = $5, fee_kind = $6, fee_percent = $7, no_show_fee_kind = $8, no_show_fee_percent = $9
         where id = $1 and property_id = $2 returning ${CXL_COLS}`,
        [id, propertyId, ...v],
      );
      if (!rows[0]) throw new Error("Cancellation Policy not found");
      return toCxl(rows[0]);
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Cancellation Policy "${v[0]}" already exists at this property`);
      throw err;
    }
  });
}

export async function listCancellationPolicies(pool: Pool, schema: string, propertyId: string): Promise<CancellationPolicy[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<CxlRow>(`select ${CXL_COLS} from cancellation_policies where property_id = $1 order by name`, [propertyId]);
    return rows.map(toCxl);
  });
}
