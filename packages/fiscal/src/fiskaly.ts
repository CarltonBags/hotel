import { FiscalUnavailable, type CashRegisterInfo, type FiscalProvider, type JobState, type SignInput, type SignedTx, type TssCreated } from "./provider";

const SIGN = "https://kassensichv-middleware.fiskaly.com/api/v2";
const DSFINVK = "https://dsfinvk.fiskaly.com/api/v1";
/** fiskaly's guidance: signing 3 to 5 seconds in all, authentication 3 to 4, TSS set-up 30 and more, DSFinV-K up to minutes. */
const SIGN_BUDGET_MS = 5000;
const RESCUE_MS = 2500;
const AUTH_MS = 4000;
const SETUP_MS = 45_000;
const DSFINVK_MS = 120_000;

type Json = Record<string, unknown>;

class FiskalyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`fiskaly ${status} ${code}: ${message}`);
  }
}

const notFound = (err: unknown) => err instanceof FiskalyError && err.status === 404;

/**
 * fiskaly SIGN DE v2 and DSFinV-K v1 (ticket 51). Signing shares one cached
 * access token, renewed on a 401; the admin steps (TSS set-up, a new client)
 * log in on a token of their own, so a concurrent login or logout never
 * cuts into a signature. A signature has 5 seconds in all; one that fails
 * after its transaction started is looked up once more and, if still open,
 * cancelled, so the TSE never keeps a transaction we record as an outage.
 * Test or live is decided by the API key.
 */
export class FiskalyProvider implements FiscalProvider {
  readonly name = "fiskaly";
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async login(): Promise<{ value: string; until: number }> {
    const r = await this.fetchImpl(`${SIGN}/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: this.apiKey, api_secret: this.apiSecret }), signal: AbortSignal.timeout(AUTH_MS) });
    if (!r.ok) throw await errorOf(r);
    const b = (await r.json()) as { access_token: string; access_token_expires_in: number };
    return { value: b.access_token, until: Date.now() + (b.access_token_expires_in - 300) * 1000 };
  }

  private async shared(force: boolean): Promise<string> {
    if (force || !this.token || this.token.until <= Date.now()) this.token = await this.login();
    return this.token.value;
  }

  /** One request; `token` given: an admin session's own, else the shared one (renewed once on a 401). */
  private async call(base: string, method: string, path: string, opts: { body?: unknown; ms: number; signal?: AbortSignal; token?: string; raw?: boolean }): Promise<Json | Uint8Array> {
    for (let attempt = 0; ; attempt++) {
      const token = opts.token ?? (await this.shared(attempt > 0));
      const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.ms)]) : AbortSignal.timeout(opts.ms);
      const r = await this.fetchImpl(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(opts.body === undefined ? {} : { "content-type": "application/json" }) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal,
      });
      if (r.status === 401 && attempt === 0 && !opts.token) continue;
      if (!r.ok) throw await errorOf(r);
      return opts.raw ? new Uint8Array(await r.arrayBuffer()) : ((await r.json().catch(() => ({}))) as Json);
    }
  }

  private json(base: string, method: string, path: string, opts: { body?: unknown; ms: number; signal?: AbortSignal; token?: string }): Promise<Json> {
    return this.call(base, method, path, opts) as Promise<Json>;
  }

  /** Run admin steps on a token of their own, logged in and out around them. */
  private async asAdmin<T>(tssId: string, adminPin: string, steps: (token: string) => Promise<T>): Promise<T> {
    const token = (await this.login()).value;
    await this.json(SIGN, "POST", `/tss/${tssId}/admin/auth`, { body: { admin_pin: adminPin }, ms: SETUP_MS, token });
    try {
      return await steps(token);
    } finally {
      await this.json(SIGN, "POST", `/tss/${tssId}/admin/logout`, { body: {}, ms: AUTH_MS, token }).catch(() => undefined);
    }
  }

  async createTss(tssId: string, adminPin: string): Promise<TssCreated> {
    const created = await this.json(SIGN, "PUT", `/tss/${tssId}`, { body: { metadata: { by: "hoteloftware" } }, ms: SETUP_MS });
    await this.json(SIGN, "PATCH", `/tss/${tssId}`, { body: { state: "UNINITIALIZED" }, ms: SETUP_MS });
    await this.json(SIGN, "PATCH", `/tss/${tssId}/admin`, { body: { admin_puk: created.admin_puk, new_admin_pin: adminPin }, ms: SETUP_MS });
    await this.asAdmin(tssId, adminPin, (token) => this.json(SIGN, "PATCH", `/tss/${tssId}`, { body: { state: "INITIALIZED" }, ms: SETUP_MS, token }));
    return {
      serialNumber: String(created.serial_number),
      publicKey: String(created.public_key),
      signatureAlgorithm: String(created.signature_algorithm ?? "ecdsa-plain-SHA256"),
      timestampFormat: String(created.signature_timestamp_format ?? "unixTime"),
      adminPuk: String(created.admin_puk),
    };
  }

  async registerClient(tssId: string, clientId: string, serial: string, adminPin: string): Promise<void> {
    await this.asAdmin(tssId, adminPin, async (token) => {
      try {
        await this.json(SIGN, "PUT", `/tss/${tssId}/client/${clientId}`, { body: { serial_number: serial }, ms: SETUP_MS, token });
      } catch (err) {
        // the client exists already: nothing to do
        if (!(err instanceof FiskalyError && err.status === 409)) throw err;
      }
    });
  }

  async sign(input: SignInput): Promise<SignedTx> {
    const tx = `/tss/${input.tssId}/tx/${input.txId}`;
    const budget = AbortSignal.timeout(SIGN_BUDGET_MS);
    let latest = 0;
    try {
      // a retry continues the Receipt's own transaction: fiskaly is asked what it has (only "not found" means nothing)
      let t = input.retry ? await this.json(SIGN, "GET", tx, { ms: SIGN_BUDGET_MS, signal: budget }).catch((err: unknown) => (notFound(err) ? null : Promise.reject(err))) : null;
      if (t) latest = Number(t.latest_revision ?? t.revision ?? 0);
      if (t?.state !== "FINISHED") {
        if (!t) {
          await this.json(SIGN, "PUT", `${tx}?tx_revision=1`, { body: { state: "ACTIVE", client_id: input.clientId }, ms: SIGN_BUDGET_MS, signal: budget });
          latest = 1;
        }
        t = await this.json(SIGN, "PUT", `${tx}?tx_revision=${latest + 1}`, { body: finishBody(input), ms: SIGN_BUDGET_MS, signal: budget });
      }
      return signedOf(t);
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 200) : "TSE not available";
      // started but not known to be finished: look once more; still open, cancel it
      if (latest > 0) {
        const seen = await this.json(SIGN, "GET", tx, { ms: RESCUE_MS }).catch(() => null);
        if (seen?.state === "FINISHED") return signedOf(seen);
        if (seen?.state === "ACTIVE") {
          const rev = Number(seen.latest_revision ?? seen.revision ?? latest) + 1;
          await this.json(SIGN, "PUT", `${tx}?tx_revision=${rev}`, { body: { state: "CANCELLED", client_id: input.clientId, schema: { standard_v1: { receipt: { receipt_type: "CANCELLATION", amounts_per_vat_rate: [] } } } }, ms: RESCUE_MS }).catch(() => undefined);
        }
      }
      throw new FiscalUnavailable(message);
    }
  }

  async registerCashRegister(clientId: string, tssId: string, info: CashRegisterInfo): Promise<void> {
    await this.json(DSFINVK, "PUT", `/cash_registers/${clientId}`, {
      body: { cash_register_type: { type: "MASTER", tss_id: tssId }, brand: info.brand, model: info.model, software: info.software, base_currency_code: info.currency },
      ms: DSFINVK_MS,
    });
  }

  /** A job at the provider by our id: looked up, made once if unknown, then followed until done. */
  private async job(base: string, path: string, create: () => Promise<Json>, file?: string): Promise<JobState> {
    const found = await this.json(base, "GET", path, { ms: DSFINVK_MS }).catch((err: unknown) => (notFound(err) ? null : Promise.reject(err)));
    const s = jobState(found ?? (await create()));
    if (s.state !== "completed" || !file) return s;
    return { state: "completed", file: (await this.call(base, "GET", `${path}${file}`, { ms: DSFINVK_MS, raw: true })) as Uint8Array };
  }

  closing(closingId: string, payload: unknown): Promise<JobState> {
    const path = `/cash_point_closings/${closingId}`;
    return this.job(DSFINVK, path, () => this.json(DSFINVK, "PUT", path, { body: payload, ms: DSFINVK_MS }));
  }

  tssExport(tssId: string, exportId: string, from: Date, to: Date): Promise<JobState> {
    const path = `/tss/${tssId}/export/${exportId}`;
    const query = `?start_date=${Math.floor(from.getTime() / 1000)}&end_date=${Math.floor(to.getTime() / 1000)}`;
    return this.job(SIGN, path, () => this.json(SIGN, "PUT", `${path}${query}`, { ms: SETUP_MS }), "/file");
  }

  dsfinvkExport(exportId: string, from: string, to: string, clientId?: string): Promise<JobState> {
    const path = `/exports/${exportId}`;
    return this.job(DSFINVK, path, () => this.json(DSFINVK, "PUT", path, { body: { business_date_start: from, business_date_end: to, format: "tar", ...(clientId ? { client_id: clientId } : {}) }, ms: DSFINVK_MS }), "/download");
  }
}

async function errorOf(r: Response): Promise<FiskalyError> {
  const b = (await r.json().catch(() => ({}))) as { code?: string; message?: string };
  return new FiskalyError(r.status, b.code ?? "", b.message ?? r.statusText);
}

function finishBody(input: SignInput): Json {
  const metadata = input.metadata ? { metadata: input.metadata } : {};
  if (input.order) {
    return {
      state: "FINISHED",
      client_id: input.clientId,
      ...metadata,
      schema: { standard_v1: { order: { line_items: input.order.lineItems.map((l) => ({ quantity: l.quantity, text: l.text, price_per_unit: l.pricePerUnit })) } } },
    };
  }
  return {
    state: "FINISHED",
    client_id: input.clientId,
    ...metadata,
    schema: {
      standard_v1: {
        receipt: {
          receipt_type: "RECEIPT",
          amounts_per_vat_rate: input.amountsPerVatRate.map((a) => ({ vat_rate: a.vatRate, amount: a.amount })),
          amounts_per_payment_type: input.amountsPerPaymentType.map((a) => ({ payment_type: a.paymentType, amount: a.amount, currency_code: a.currency })),
        },
      },
    },
  };
}

function signedOf(t: Json): SignedTx {
  const sig = t.signature as Json;
  const log = (t.log ?? {}) as Json;
  return {
    number: Number(t.number),
    timeStart: new Date(Number(t.time_start) * 1000),
    timeEnd: new Date(Number(t.time_end) * 1000),
    signature: String(sig.value),
    // fiskaly sends the counter as a number though its spec says string
    signatureCounter: Number(sig.counter),
    algorithm: String(sig.algorithm),
    publicKey: String(sig.public_key),
    tssSerial: String(t.tss_serial_number),
    clientSerial: String(t.client_serial_number),
    timestampFormat: String(log.timestamp_format ?? "unixTime"),
    qrCodeData: String(t.qr_code_data),
  };
}

function jobState(j: Json): JobState {
  const s = String(j.state ?? "");
  if (s === "COMPLETED") return { state: "completed" };
  if (s === "ERROR" || s === "CANCELLED") return { state: "failed", error: String((j.error as Json | undefined)?.message ?? j.error ?? s).slice(0, 300) };
  return { state: "working" };
}
