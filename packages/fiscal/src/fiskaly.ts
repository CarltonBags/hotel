import { FiscalUnavailable, type CashRegisterInfo, type FiscalProvider, type JobState, type SignInput, type SignedTx, type TssCreated } from "./provider";

const SIGN = "https://kassensichv-middleware.fiskaly.com/api/v2";
const DSFINVK = "https://dsfinvk.fiskaly.com/api/v1";
/** fiskaly's guidance: signing 3 to 5 seconds, authentication 3 to 4, TSS set-up 30 and more, DSFinV-K up to minutes. */
const SIGN_MS = 4000;
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

/**
 * fiskaly SIGN DE v2 and DSFinV-K v1 (ticket 51). One access token for both,
 * cached until shortly before it expires and renewed on a 401. Test or live
 * is decided by the API key. Admin rights hang on the token, so the admin
 * steps log in and out around themselves.
 */
export class FiskalyProvider implements FiscalProvider {
  readonly name = "fiskaly";
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async auth(force = false): Promise<string> {
    if (!force && this.token && this.token.until > Date.now()) return this.token.value;
    const r = await this.fetchImpl(`${SIGN}/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: this.apiKey, api_secret: this.apiSecret }), signal: AbortSignal.timeout(AUTH_MS) });
    if (!r.ok) throw await this.error(r);
    const b = (await r.json()) as { access_token: string; access_token_expires_in: number };
    this.token = { value: b.access_token, until: Date.now() + (b.access_token_expires_in - 300) * 1000 };
    return b.access_token;
  }

  private async error(r: Response): Promise<FiskalyError> {
    const b = (await r.json().catch(() => ({}))) as { code?: string; message?: string };
    return new FiskalyError(r.status, b.code ?? "", b.message ?? r.statusText);
  }

  private async call(base: string, method: string, path: string, body: unknown, ms: number, raw = false): Promise<Json | Uint8Array> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth(attempt > 0);
      const r = await this.fetchImpl(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(ms),
      });
      // an expired token: once more with a fresh one
      if (r.status === 401 && attempt === 0) continue;
      if (!r.ok) throw await this.error(r);
      return raw ? new Uint8Array(await r.arrayBuffer()) : ((await r.json().catch(() => ({}))) as Json);
    }
  }

  private sign_(method: string, path: string, body?: unknown, ms = SETUP_MS) {
    return this.call(SIGN, method, path, body, ms) as Promise<Json>;
  }

  async createTss(tssId: string, adminPin: string): Promise<TssCreated> {
    const created = await this.sign_("PUT", `/tss/${tssId}`, { metadata: { by: "hoteloftware" } });
    await this.sign_("PATCH", `/tss/${tssId}`, { state: "UNINITIALIZED" });
    await this.sign_("PATCH", `/tss/${tssId}/admin`, { admin_puk: created.admin_puk, new_admin_pin: adminPin });
    await this.sign_("POST", `/tss/${tssId}/admin/auth`, { admin_pin: adminPin });
    try {
      await this.sign_("PATCH", `/tss/${tssId}`, { state: "INITIALIZED" });
    } finally {
      await this.sign_("POST", `/tss/${tssId}/admin/logout`, {}).catch(() => undefined);
    }
    return {
      serialNumber: String(created.serial_number),
      publicKey: String(created.public_key),
      signatureAlgorithm: String(created.signature_algorithm ?? "ecdsa-plain-SHA256"),
      timestampFormat: String(created.signature_timestamp_format ?? "unixTime"),
      adminPuk: String(created.admin_puk),
    };
  }

  async registerClient(tssId: string, clientId: string, serial: string, adminPin: string): Promise<void> {
    await this.sign_("POST", `/tss/${tssId}/admin/auth`, { admin_pin: adminPin });
    try {
      await this.sign_("PUT", `/tss/${tssId}/client/${clientId}`, { serial_number: serial });
    } catch (err) {
      // the client exists already: nothing to do
      if (!(err instanceof FiskalyError && err.status === 409)) throw err;
    } finally {
      await this.sign_("POST", `/tss/${tssId}/admin/logout`, {}).catch(() => undefined);
    }
  }

  async sign(input: SignInput): Promise<SignedTx> {
    const path = (rev: number) => `/tss/${input.tssId}/tx/${input.txId}?tx_revision=${rev}`;
    try {
      // a retry of the same Receipt continues its transaction instead of starting a second one
      let tx = input.retry ? ((await this.call(SIGN, "GET", `/tss/${input.tssId}/tx/${input.txId}`, undefined, SIGN_MS).catch(() => null)) as Json | null) : null;
      if (!tx || tx.state !== "FINISHED") {
        if (!tx) await this.call(SIGN, "PUT", path(1), { state: "ACTIVE", client_id: input.clientId }, SIGN_MS);
        const rev = tx ? Number(tx.latest_revision ?? tx.revision ?? 1) + 1 : 2;
        tx = (await this.call(
          SIGN,
          "PUT",
          path(rev),
          {
            state: "FINISHED",
            client_id: input.clientId,
            schema: {
              standard_v1: {
                receipt: {
                  receipt_type: "RECEIPT",
                  amounts_per_vat_rate: input.amountsPerVatRate.map((a) => ({ vat_rate: a.vatRate, amount: a.amount })),
                  amounts_per_payment_type: input.amountsPerPaymentType.map((a) => ({ payment_type: a.paymentType, amount: a.amount, currency_code: a.currency })),
                },
              },
            },
          },
          SIGN_MS,
        )) as Json;
      }
      const sig = tx.signature as Json;
      const log = (tx.log ?? {}) as Json;
      return {
        number: Number(tx.number),
        timeStart: new Date(Number(tx.time_start) * 1000),
        timeEnd: new Date(Number(tx.time_end) * 1000),
        signature: String(sig.value),
        // fiskaly sends the counter as a number though its spec says string
        signatureCounter: Number(sig.counter),
        algorithm: String(sig.algorithm),
        publicKey: String(sig.public_key),
        tssSerial: String(tx.tss_serial_number),
        clientSerial: String(tx.client_serial_number),
        timestampFormat: String(log.timestamp_format ?? "unixTime"),
        qrCodeData: String(tx.qr_code_data),
      };
    } catch (err) {
      throw new FiscalUnavailable(err instanceof Error ? err.message.slice(0, 200) : "TSE not available");
    }
  }

  async registerCashRegister(clientId: string, tssId: string, info: CashRegisterInfo): Promise<void> {
    await this.call(
      DSFINVK,
      "PUT",
      `/cash_registers/${clientId}`,
      { cash_register_type: { type: "MASTER", tss_id: tssId }, brand: info.brand, model: info.model, software: info.software, base_currency_code: info.currency },
      DSFINVK_MS,
    );
  }

  async closing(closingId: string, payload: unknown): Promise<JobState> {
    let c = (await this.call(DSFINVK, "GET", `/cash_point_closings/${closingId}`, undefined, DSFINVK_MS).catch((err: unknown) => (err instanceof FiskalyError && err.status === 404 ? null : Promise.reject(err)))) as Json | null;
    if (!c) c = (await this.call(DSFINVK, "PUT", `/cash_point_closings/${closingId}`, payload, DSFINVK_MS)) as Json;
    return jobState(c);
  }

  async tssExport(tssId: string, exportId: string, from: Date, to: Date): Promise<JobState> {
    const base = `/tss/${tssId}/export/${exportId}`;
    let e = (await this.call(SIGN, "GET", base, undefined, SETUP_MS).catch((err: unknown) => (err instanceof FiskalyError && err.status === 404 ? null : Promise.reject(err)))) as Json | null;
    if (!e) e = (await this.call(SIGN, "PUT", `${base}?start_date=${Math.floor(from.getTime() / 1000)}&end_date=${Math.floor(to.getTime() / 1000)}`, undefined, SETUP_MS)) as Json;
    const s = jobState(e);
    if (s.state !== "completed") return s;
    return { state: "completed", file: (await this.call(SIGN, "GET", `${base}/file`, undefined, DSFINVK_MS, true)) as Uint8Array };
  }

  async dsfinvkExport(exportId: string, from: string, to: string, clientId?: string): Promise<JobState> {
    const base = `/exports/${exportId}`;
    let e = (await this.call(DSFINVK, "GET", base, undefined, DSFINVK_MS).catch((err: unknown) => (err instanceof FiskalyError && err.status === 404 ? null : Promise.reject(err)))) as Json | null;
    if (!e) e = (await this.call(DSFINVK, "PUT", base, { business_date_start: from, business_date_end: to, format: "tar", ...(clientId ? { client_id: clientId } : {}) }, DSFINVK_MS)) as Json;
    const s = jobState(e);
    if (s.state !== "completed") return s;
    return { state: "completed", file: (await this.call(DSFINVK, "GET", `${base}/download`, undefined, DSFINVK_MS, true)) as Uint8Array };
  }
}

function jobState(j: Json): JobState {
  const s = String(j.state ?? "");
  if (s === "COMPLETED") return { state: "completed" };
  if (s === "ERROR" || s === "CANCELLED") return { state: "failed", error: String((j.error as Json | undefined)?.message ?? j.error ?? s).slice(0, 300) };
  return { state: "working" };
}
