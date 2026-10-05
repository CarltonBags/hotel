import { createHash } from "node:crypto";
import { FiscalUnavailable, type CashRegisterInfo, type FiscalProvider, type JobState, type SignInput, type SignedTx, type TssCreated } from "./provider";

/**
 * A stand-in TSE for development and tests (ticket 51): signs at once with a
 * made-up signature, keeps what it signed, and can be switched "down" to
 * play an outage.
 */
export class FakeFiscalProvider implements FiscalProvider {
  readonly name = "fake";
  down = false;
  readonly tss = new Map<string, { serial: string; pin: string; counter: number; number: number }>();
  readonly clients = new Map<string, { tssId: string; serial: string }>();
  readonly signed = new Map<string, SignedTx & { input: SignInput }>();
  readonly registers = new Set<string>();
  readonly closings = new Map<string, unknown>();

  async createTss(tssId: string, adminPin: string): Promise<TssCreated> {
    const serial = createHash("sha256").update(tssId).digest("hex");
    this.tss.set(tssId, { serial, pin: adminPin, counter: 0, number: 0 });
    return { serialNumber: serial, publicKey: `FAKE-PK-${tssId.slice(0, 8)}`, signatureAlgorithm: "ecdsa-plain-SHA256", timestampFormat: "unixTime", adminPuk: "FAKEPUK1234" };
  }

  async registerClient(tssId: string, clientId: string, serial: string, adminPin: string): Promise<void> {
    if (this.down) throw new FiscalUnavailable("TSS not available");
    // a development server restarted: the TSS is known again by its id
    const t = this.tss.get(tssId) ?? { serial: createHash("sha256").update(tssId).digest("hex"), pin: adminPin, counter: 0, number: 0 };
    this.tss.set(tssId, t);
    if (t.pin !== adminPin) throw new Error("Wrong admin PIN");
    this.clients.set(clientId, { tssId, serial });
  }

  async sign(input: SignInput): Promise<SignedTx> {
    if (this.down) throw new FiscalUnavailable("TSS not available");
    const done = this.signed.get(input.txId);
    if (done) return done;
    // a development server restarted: the stand-in picks up the TSS and client it signed for before
    const t = this.tss.get(input.tssId) ?? { serial: createHash("sha256").update(input.tssId).digest("hex"), pin: "", counter: 0, number: 0 };
    this.tss.set(input.tssId, t);
    const c = this.clients.get(input.clientId) ?? { tssId: input.tssId, serial: `HS-${input.clientId.replace(/-/g, "").toUpperCase()}` };
    t.number += 1;
    t.counter += 2;
    const now = new Date();
    const tx: SignedTx = {
      number: t.number,
      timeStart: now,
      timeEnd: now,
      signature: createHash("sha256").update(`${input.txId}:${t.counter}`).digest("base64"),
      signatureCounter: t.counter,
      algorithm: "ecdsa-plain-SHA256",
      publicKey: `FAKE-PK-${input.tssId.slice(0, 8)}`,
      tssSerial: t.serial,
      clientSerial: c.serial,
      timestampFormat: "unixTime",
      qrCodeData: input.order ? `V0;${c.serial};Bestellung-V1;${input.order.lineItems.map((l) => `${l.quantity};"${l.text}";${l.pricePerUnit}`).join("/")}` : `V0;${c.serial};Kassenbeleg-V1;Beleg^${input.amountsPerVatRate.map((a) => a.amount).join("_")}^${input.amountsPerPaymentType.map((p) => `${p.amount}:${p.paymentType === "CASH" ? "Bar" : "Unbar"}`).join("_")};${t.number};${t.counter};${Math.floor(now.getTime() / 1000)};${Math.floor(now.getTime() / 1000)};ecdsa-plain-SHA256;unixTime;FAKESIG;FAKE-PK`,
    };
    this.signed.set(input.txId, { ...tx, input });
    return tx;
  }

  async registerCashRegister(clientId: string, _tssId: string, _info: CashRegisterInfo): Promise<void> {
    this.registers.add(clientId);
  }

  async closing(closingId: string, payload: unknown): Promise<JobState> {
    if (this.down) throw new Error("DSFinV-K not available");
    const p = payload as { client_id?: string };
    if (!p.client_id || !this.registers.has(p.client_id)) return { state: "failed", error: "E_CASH_REGISTER_NOT_FOUND" };
    this.closings.set(closingId, payload);
    return { state: "completed" };
  }

  async tssExport(tssId: string, exportId: string, from: Date, to: Date): Promise<JobState> {
    if (this.down) throw new Error("TSS export not available");
    return { state: "completed", file: new TextEncoder().encode(`FAKE TSS EXPORT ${tssId} ${exportId} ${from.toISOString()} ${to.toISOString()}`) };
  }

  async dsfinvkExport(exportId: string, from: string, to: string): Promise<JobState> {
    if (this.down) throw new Error("DSFinV-K not available");
    return { state: "completed", file: new TextEncoder().encode(`FAKE DSFINV-K EXPORT ${exportId} ${from} ${to} closings=${this.closings.size}`) };
  }
}
