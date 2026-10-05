import { FiscalRefused, FiscalUnavailable } from "./provider";
import type { AtAccount, AtFiscalProvider, AtSignInput, AtSignedReceipt, AtSystemReceipt, AtSystemReceiptType, FonCredentials } from "./at";

const BASE = "https://rksv.fiskaly.com/api/v1";
const SIGN_BUDGET_MS = 5000;
const SETUP_MS = 60_000;
const EXPORT_MS = 120_000;
const SYSTEM_TYPES: AtSystemReceiptType[] = ["INITIALIZATION", "MONTHLY_CLOSE", "YEARLY_CLOSE", "DECOMMISSION", "SIGNATURE_CREATION_UNIT_FAULT_CLEARANCE"];

type Json = Record<string, unknown>;

class FiskalyAtError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`fiskaly ${status} ${code}: ${message}`);
  }
}

/**
 * fiskaly SIGN AT v1 (ticket 52), one organisation per Legal Entity, so
 * the account comes with each call; tokens cached per account. Test or
 * live is decided by the account's key.
 */
export class FiskalyAtProvider implements AtFiscalProvider {
  readonly name = "fiskaly";
  private tokens = new Map<string, { value: string; until: number }>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async token(a: AtAccount, force: boolean): Promise<string> {
    const had = this.tokens.get(a.apiKey);
    if (!force && had && had.until > Date.now()) return had.value;
    const r = await this.fetchImpl(`${BASE}/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: a.apiKey, api_secret: a.apiSecret }), signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw await errorOf(r);
    const b = (await r.json()) as { access_token: string; access_token_expires_in: number };
    this.tokens.set(a.apiKey, { value: b.access_token, until: Date.now() + (b.access_token_expires_in - 300) * 1000 });
    return b.access_token;
  }

  private async call(a: AtAccount, method: string, path: string, opts: { body?: unknown; ms: number; signal?: AbortSignal; raw?: boolean }): Promise<Json | Uint8Array> {
    for (let attempt = 0; ; attempt++) {
      const t = await this.token(a, attempt > 0);
      const r = await this.fetchImpl(`${BASE}${path}`, {
        method,
        headers: { authorization: `Bearer ${t}`, ...(opts.body === undefined ? {} : { "content-type": "application/json" }) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.ms)]) : AbortSignal.timeout(opts.ms),
      });
      if (r.status === 401 && attempt === 0) continue;
      if (!r.ok) throw await errorOf(r);
      return opts.raw ? new Uint8Array(await r.arrayBuffer()) : ((await r.json().catch(() => ({}))) as Json);
    }
  }

  private json(a: AtAccount, method: string, path: string, opts: { body?: unknown; ms: number; signal?: AbortSignal }): Promise<Json> {
    return this.call(a, method, path, opts) as Promise<Json>;
  }

  /** A state change FinanzOnline answers slowly: on a timeout, asked again until it shows. */
  private async toState(a: AtAccount, path: string, state: string): Promise<Json> {
    try {
      return await this.json(a, "PATCH", path, { body: { state }, ms: SETUP_MS });
    } catch (err) {
      if (!(err instanceof FiskalyAtError && (err.status === 408 || err.status === 504))) throw err;
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const now = await this.json(a, "GET", path, { ms: SETUP_MS });
        if (now.state === state) return now;
      }
      throw err;
    }
  }

  async fonAuth(a: AtAccount, fon: FonCredentials): Promise<void> {
    await this.json(a, "PUT", "/fon/auth", { body: { fon_participant_id: fon.participantId, fon_user_id: fon.userId, fon_user_pin: fon.pin }, ms: SETUP_MS });
  }

  async createScu(a: AtAccount, scuId: string, taxId: { vatId: string } | { taxNumber: string }, name: string): Promise<{ certificateSerial: string }> {
    const path = `/signature-creation-unit/${scuId}`;
    await this.json(a, "PUT", path, { body: { legal_entity_id: "vatId" in taxId ? { vat_id: taxId.vatId } : { tax_id: taxId.taxNumber }, legal_entity_name: name }, ms: SETUP_MS });
    const done = await this.toState(a, path, "INITIALIZED");
    return { certificateSerial: String(done.certificate_serial_number ?? "") };
  }

  async createRegister(a: AtAccount, registerId: string, description: string): Promise<{ serial: string; initializationReceiptId: string | null }> {
    const path = `/cash-register/${registerId}`;
    const made = await this.json(a, "PUT", path, { body: { description: description.slice(0, 100) }, ms: SETUP_MS });
    if (made.state === "CREATED") await this.toState(a, path, "REGISTERED");
    const done = made.state === "INITIALIZED" ? made : await this.toState(a, path, "INITIALIZED");
    return { serial: String(done.serial_number), initializationReceiptId: done.initialization_receipt_id ? String(done.initialization_receipt_id) : null };
  }

  async sign(a: AtAccount, input: AtSignInput): Promise<AtSignedReceipt> {
    const budget = AbortSignal.timeout(SIGN_BUDGET_MS);
    const path = `/cash-register/${input.registerId}/receipt/${input.receiptId}`;
    try {
      // a retry asks first: the receipt may have been signed after the last attempt gave up
      const had = input.retry ? await this.json(a, "GET", path, { ms: SIGN_BUDGET_MS, signal: budget }).catch((err: unknown) => (err instanceof FiskalyAtError && err.status === 404 ? null : Promise.reject(err))) : null;
      if (had) return receiptOf(had);
      try {
        return receiptOf(
          await this.json(a, "PUT", path, {
            body: {
              receipt_type: input.type,
              schema: {
                standard_v1: {
                  amounts_per_vat_rate: input.amountsPerVatRate.map((x) => ({ vat_rate: x.vatRate, amount: x.amount })),
                  amounts_per_payment_type: input.amountsPerPaymentType.map((x) => ({ payment_type: x.paymentType, amount: x.amount, currency_code: x.currency })),
                  line_items: input.lineItems.map((l) => ({ quantity: l.quantity, text: l.text, price_per_unit: l.pricePerUnit })),
                },
              },
              ...(input.metadata ? { metadata: input.metadata } : {}),
            },
            ms: SIGN_BUDGET_MS,
            signal: budget,
          }),
        );
      } catch (err) {
        // signed already under this id: what the provider has stands
        if (err instanceof FiskalyAtError && err.status === 409) return receiptOf(await this.json(a, "GET", path, { ms: SIGN_BUDGET_MS }));
        throw err;
      }
    } catch (err) {
      // a request it will not sign is refused for good; anything else (no answer, 5xx, 429) is an outage
      if (err instanceof FiskalyAtError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 408 && err.status !== 429) throw new FiscalRefused(err.message.slice(0, 200));
      throw new FiscalUnavailable(err instanceof Error ? err.message.slice(0, 200) : "Signature service not available");
    }
  }

  async setRegisterOutage(a: AtAccount, registerId: string, outage: boolean): Promise<void> {
    await this.toState(a, `/cash-register/${registerId}`, outage ? "OUTAGE" : "INITIALIZED");
  }

  async systemReceipts(a: AtAccount, registerId: string): Promise<AtSystemReceipt[]> {
    const q = SYSTEM_TYPES.map((t) => `receipt_types[]=${t}`).join("&");
    const page = await this.json(a, "GET", `/cash-register/${registerId}/receipt?${q}&order_by=receipt_number&order=DESC&limit=100`, { ms: SETUP_MS });
    const items = (Array.isArray(page.data) ? page.data : []) as Json[];
    return items.map((r) => {
      const v = Array.isArray(r.fon_validations) ? (r.fon_validations as Json[]).at(-1) : undefined;
      return {
        id: String(r._id),
        type: r.receipt_type as AtSystemReceiptType,
        receiptNumber: String(r.receipt_number),
        timeSignature: new Date(Number(r.time_signature) * 1000),
        qrCodeData: String(r.qr_code_data ?? ""),
        validation: v ? (v.validation_result === "SUCCESS" ? "SUCCESS" : "ERROR") : null,
      };
    });
  }

  async dep(a: AtAccount, registerId: string, from: Date, to: Date): Promise<Uint8Array> {
    const s = (d: Date) => Math.floor(d.getTime() / 1000);
    return (await this.call(a, "GET", `/cash-register/${registerId}/export?start_time_signature=${s(from)}&end_time_signature=${s(to)}`, { ms: EXPORT_MS, raw: true })) as Uint8Array;
  }
}

function receiptOf(r: Json): AtSignedReceipt {
  return {
    receiptNumber: String(r.receipt_number),
    timeSignature: new Date(Number(r.time_signature) * 1000),
    registerSerial: String(r.cash_register_serial_number),
    qrCodeData: String(r.qr_code_data),
    signed: r.signed !== false,
    hints: Array.isArray(r.hints) ? r.hints.map(String) : [],
  };
}

async function errorOf(r: Response): Promise<FiskalyAtError> {
  const b = (await r.json().catch(() => ({}))) as { code?: string; message?: string };
  return new FiskalyAtError(r.status, b.code ?? "", b.message ?? r.statusText);
}
