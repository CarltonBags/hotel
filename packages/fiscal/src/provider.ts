/**
 * The fiscal module's provider (ticket 51, ADR 0013): a cloud signing
 * service behind one interface, so the provider can change per country.
 * Germany: a TSE (here the TSS) per property, one client per Cash Register,
 * a signed transaction per Receipt, DSFinV-K closings and exports.
 */

export type VatRate = "NORMAL" | "REDUCED_1" | "SPECIAL_RATE_1" | "SPECIAL_RATE_2" | "NULL";
export type PaymentType = "CASH" | "NON_CASH";

export interface TssCreated {
  serialNumber: string;
  publicKey: string;
  signatureAlgorithm: string;
  timestampFormat: string;
  /** Unblocks the admin PIN; shown once, kept sealed. */
  adminPuk: string;
}

export interface SignInput {
  tssId: string;
  clientId: string;
  /** Our id for the transaction: the same id again never signs twice. */
  txId: string;
  /** A second attempt for the same Receipt: the provider is asked what it already has. */
  retry?: boolean;
  amountsPerVatRate: { vatRate: VatRate; amount: string }[];
  amountsPerPaymentType: { paymentType: PaymentType; amount: string; currency: string }[];
}

export interface SignedTx {
  number: number;
  timeStart: Date;
  timeEnd: Date;
  signature: string;
  signatureCounter: number;
  algorithm: string;
  publicKey: string;
  tssSerial: string;
  clientSerial: string;
  timestampFormat: string;
  qrCodeData: string;
}

/** A long-running job at the provider (a closing, an export): asked again until it is done. */
export type JobState = { state: "working" } | { state: "completed"; file?: Uint8Array } | { state: "failed"; error: string };

export interface CashRegisterInfo {
  brand: string;
  model: string;
  software: { brand: string; version: string };
  currency: string;
}

export interface FiscalProvider {
  readonly name: string;
  /** A new TSS from zero to initialized, its admin PIN set to `adminPin`. */
  createTss(tssId: string, adminPin: string): Promise<TssCreated>;
  /** A client (Cash Register) with its immutable serial; again for the same id is harmless. */
  registerClient(tssId: string, clientId: string, serial: string, adminPin: string): Promise<void>;
  /** Sign a Receipt; throws when the TSE cannot sign (the caller's outage path). */
  sign(input: SignInput): Promise<SignedTx>;
  /** DSFinV-K: the Cash Register's master data, before its first closing. */
  registerCashRegister(clientId: string, tssId: string, info: CashRegisterInfo): Promise<void>;
  /** DSFinV-K: a daily closing (sent once, then asked for its state). */
  closing(closingId: string, payload: unknown): Promise<JobState>;
  /** The TSS's signed data for a period, as TAR (the archive, since the provider keeps it only for a while). */
  tssExport(tssId: string, exportId: string, from: Date, to: Date): Promise<JobState>;
  /** The DSFinV-K export for business dates, as TAR. */
  dsfinvkExport(exportId: string, from: string, to: string, clientId?: string): Promise<JobState>;
}

/** The signing service did not answer or refused: the desk goes on, the Receipt says so. */
export class FiscalUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiscalUnavailable";
  }
}
