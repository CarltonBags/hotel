import net from "node:net";

/**
 * A simulated FIAS till (the plugin kit, ticket 66): connects to the FIAS
 * plugin like a Simphony or Vectron till would, looks a guest up, posts a
 * check as totals per subtotal and takes it back with a negative posting.
 */
const STX = "\x02";
const ETX = "\x03";

export class FiasTillSimulator {
  private socket: net.Socket | null = null;
  private buffer = "";
  private waiting: ((r: { type: string; fields: [string, string][] }) => void)[] = [];
  private seq = 1;

  async connect(port: number, host = "127.0.0.1"): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket = net.connect(port, host, resolve);
      this.socket.on("error", reject);
    });
    this.socket!.setEncoding("latin1");
    this.socket!.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (let end = this.buffer.indexOf(ETX); end >= 0; end = this.buffer.indexOf(ETX)) {
        const start = this.buffer.lastIndexOf(STX, end);
        const text = this.buffer.slice(start + 1, end);
        this.buffer = this.buffer.slice(end + 1);
        if (start < 0) continue;
        const [type, ...rest] = text.split("|");
        const rec = { type: type!, fields: rest.filter((f) => f.length >= 2).map((f) => [f.slice(0, 2), f.slice(2)] as [string, string]) };
        if (["LS", "LA", "LD", "LR"].includes(rec.type)) continue;
        this.waiting.shift()?.(rec);
      }
    });
    this.send("LS", []);
  }

  private send(type: string, fields: [string, string][]): void {
    this.socket!.write(`${STX}${type}|${fields.map(([k, v]) => `${k}${v}`).join("|")}|${ETX}`, "latin1");
  }

  private ask(type: string, fields: [string, string][]): Promise<{ type: string; fields: [string, string][] }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no answer from the interface")), 20_000);
      this.waiting.push((r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.send(type, [["P#", String(this.seq++)], ...fields]);
    });
  }

  /** Room or name: the guests the till may charge (room, reservation, name). */
  async inquire(term: string): Promise<{ room: string; reservation: string; name: string }[]> {
    const r = await this.ask("PR", [["PI", term]]);
    const out: { room: string; reservation: string; name: string }[] = [];
    for (const [k, v] of r.fields) {
      if (k === "RN") out.push({ room: v, reservation: "", name: "" });
      else if (k === "G#" && out.length) out.at(-1)!.reservation = v;
      else if (k === "GN" && out.length) out.at(-1)!.name = v;
    }
    return out;
  }

  /** A check posted to a room: totals per subtotal (minor units), tip apart; a negative total takes the check back. */
  async post(p: { room: string; reservation: string; check: string; workstation?: string; subtotals: Record<number, number>; tip?: number }): Promise<{ ok: boolean; text: string }> {
    const total = Object.values(p.subtotals).reduce((s, v) => s + v, 0) + (p.tip ?? 0);
    const fields: [string, string][] = [["RN", p.room], ["G#", p.reservation], ["CK", p.check], ["WS", p.workstation ?? "1"], ["DA", "261006"], ["TA", String(total)]];
    for (const [k, v] of Object.entries(p.subtotals)) fields.push([`S${k}`, String(v)]);
    if (p.tip) fields.push(["TP", String(p.tip)]);
    const r = await this.ask("PS", fields);
    const f = new Map(r.fields);
    return { ok: f.get("AS") === "OK", text: f.get("CT") ?? "" };
  }

  close(): void {
    this.socket?.destroy();
  }
}
