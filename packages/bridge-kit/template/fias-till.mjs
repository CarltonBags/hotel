// The FIAS till plugin for the Site Bridge (ticket 66): tills that expect a local interface server
// (Oracle Simphony, Vectron and others speaking FIAS) connect to it on the hotel's network; it relays
// guest lookup, postings and reversals outbound to our room charge interface (docs/room-charge-interface.md).
// Settings in the Bridge's bridge.json:
//   { "port": "5010", "allowFrom": "192.168.1.20", "api": "https://<hotel>.<our domain>/api/till/v1", "key": "hs_till_…",
//     "subtotalRates": "1:19,2:7", "serviceChargeRate": "19" }
// The plugin listens on the hotel's network for the till; only the addresses in allowFrom may connect.
// Built from the research's reading of FIAS 2.20 (records, PR inquiry → PL, PS/PR postings with TA, S1-9, D1-9, TP, SC);
// not yet checked against the specification text or a real Simphony or Vectron till.
// FIAS records: STX, a two-letter record type, fields "|XXvalue" (two-letter id), ETX. Amounts in minor units.

import net from "node:net";

const STX = "\x02";
const ETX = "\x03";

/** "PR|P#12|RN101|" → { type: "PR", fields: [["P#", "12"], ["RN", "101"]] } */
export function parseRecord(text) {
  const [type, ...rest] = text.split("|");
  return { type, fields: rest.filter((f) => f.length >= 2).map((f) => [f.slice(0, 2), f.slice(2)]) };
}

export function record(type, fields) {
  return `${STX}${type}|${fields.map(([k, v]) => `${k}${v}`).join("|")}|${ETX}`;
}

/** More than this without an ETX is not FIAS: the line is cleared. */
const MAX_BUFFER = 64_000;
/** The interface's reachability is checked at most this often for the health report. */
const REACH_CHECK_MS = 60_000;

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d = new Date()) => [["DA", `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`], ["TI", `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`]];
const cents = (v) => Number(v ?? 0) / 100;

export default {
  name: "fias-till",
  version: "1.0.0",
  kind: "till",
  create(config) {
    const port = Number(config.port ?? 5010);
    const api = String(config.api ?? "").replace(/\/$/, "");
    const rates = Object.fromEntries(String(config.subtotalRates ?? "1:19").split(",").map((p) => p.split(":").map((x) => x.trim())).filter((p) => p.length === 2).map(([k, r]) => [k, Number(r)]));
    const state = { connections: 0, lastMessageAt: null, lastError: null, reach: { ok: false, at: 0 } };
    const allowFrom = new Set(String(config.allowFrom ?? "127.0.0.1").split(",").map((a) => a.trim()).filter(Boolean));
    const serviceChargeRate = config.serviceChargeRate === undefined ? null : Number(config.serviceChargeRate);
    // what each check posted (bill id and total), to take one back; kept while the plugin runs
    const posted = new Map();
    const call = async (method, path, body) => {
      const res = await fetch(`${api}${path}`, { method, headers: { authorization: `Bearer ${config.key}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    const refuse = (message) => ({ status: 422, body: { error: "invalid", message } });

    // a posting: the posting number names the bill (a split check posts once per room); a negative posting of a whole earlier one takes it back
    const post = async (f) => {
      const total = Number(f.get("TA") ?? 0);
      const workstation = f.get("WS") ?? "";
      const check = f.get("CK") ?? "";
      const seq = f.get("P#") ?? "";
      for (let i = 1; i <= 9; i++) if (Number(f.get(`T${i}`) ?? 0) !== 0) return refuse("Tax fields not taken: post tax-inclusive subtotals");
      if (total < 0) {
        const earlier = (posted.get(`${workstation}-${check}`) ?? []).find((b) => b.total === -total && !b.corrected);
        if (!earlier) return refuse("Only a whole posted check can be taken back here");
        const r = await call("POST", `/bills/${encodeURIComponent(earlier.id)}/correction`, { id: `${earlier.id}-void-${seq}`, receiptNumber: check, fiscalId: "" });
        if (r.status === 200 || r.status === 201) earlier.corrected = true;
        return r;
      }
      // tax-inclusive subtotals per class, their discounts added; each class is a tax rate set up for this till
      const totals = new Map();
      let sum = 0;
      for (let i = 1; i <= 9; i++) {
        if (!f.has(`S${i}`) && !f.has(`D${i}`)) continue;
        const amount = Number(f.get(`S${i}`) ?? 0) + Number(f.get(`D${i}`) ?? 0);
        const rate = rates[String(i)];
        if (rate === undefined) return refuse(`No tax rate for subtotal ${i}`);
        totals.set(rate, (totals.get(rate) ?? 0) + amount);
        sum += amount;
      }
      const service = Number(f.get("SC") ?? 0);
      if (service) {
        if (serviceChargeRate === null) return refuse("Service charge not set up");
        totals.set(serviceChargeRate, (totals.get(serviceChargeRate) ?? 0) + service);
        sum += service;
      }
      const tip = Number(f.get("TP") ?? 0);
      // what goes to the room must be what the till charged
      if (sum + tip !== total) return refuse("Total does not add up");
      // check and posting numbers repeat across days: the till's date is part of the bill's id
      const id = `fias-${workstation}-${f.get("DA") ?? ""}-${check}-${seq}`;
      const r = await call("POST", "/bills", { id, reservationId: f.get("G#") ?? "", receiptNumber: check, fiscalId: "", totals: [...totals].map(([taxRate, amount]) => ({ taxRate, amount: cents(amount) })), tip: cents(tip) });
      if (r.status === 200 || r.status === 201) {
        const list = posted.get(`${workstation}-${check}`) ?? [];
        if (!list.some((b) => b.id === id)) list.push({ id, total, corrected: false });
        posted.set(`${workstation}-${check}`, list);
      }
      return r;
    };

    const handle = async (rec, socket, inquired) => {
      const f = new Map(rec.fields);
      const seq = f.get("P#") ?? "";
      if (rec.type === "LS") {
        // link start: our description and the records we take and send, then alive
        const out = [
          record("LS", stamp()),
          record("LD", [...stamp(), ["V#", "2.20"], ["IF", "PM"]]),
          record("LR", [["RI", "PR"], ["FL", "P#PIRNG#TAS1S2S3S4S5S6S7S8S9D1D2D3D4D5D6D7D8D9TPSCCKWSDATI"]]),
          record("LR", [["RI", "PS"], ["FL", "P#RNG#TAS1S2S3S4S5S6S7S8S9D1D2D3D4D5D6D7D8D9TPSCCKWSDATI"]]),
          record("LR", [["RI", "PL"], ["FL", "P#RNG#GNCLDATI"]]),
          record("LR", [["RI", "PA"], ["FL", "P#ASRNCTDATI"]]),
          record("LA", stamp()),
        ];
        for (const r of out) socket.write(r, "latin1");
        return;
      }
      if (rec.type === "LA") return;
      // an inquiry: the checked-in guests the till may charge, room or name
      if (rec.type === "PR" && f.has("PI")) {
        // a room or a name, never the whole house
        const term = (f.get("PI") ?? "").trim();
        const r = term ? await call("GET", `/guests?term=${encodeURIComponent(term)}`) : { status: 200, body: { guests: [] } };
        if (r.status !== 200 || !Array.isArray(r.body?.guests)) {
          socket.write(record("PA", [["P#", seq], ["AS", "NG"], ["CT", "Interface not available"], ...stamp()]), "latin1");
          return;
        }
        const fields = [["P#", seq]];
        for (const g of r.body.guests) inquired.add(g.reservationId);
        for (const g of r.body.guests) fields.push(["RN", g.room ?? ""], ["G#", g.reservationId], ["GN", `${g.lastName}, ${g.firstName}`.slice(0, 40)], ["CL", String(Math.round(g.remainingLimit * 100))]);
        socket.write(record("PL", [...fields, ...stamp()]), "latin1");
        return;
      }
      if (rec.type === "PS" || (rec.type === "PR" && f.has("TA"))) {
        // a posting needs an inquiry before it that offered this guest (FIAS: postings follow an inquiry)
        const r = Number(f.get("TA") ?? 0) >= 0 && !inquired.has(f.get("G#") ?? "") ? refuse("Look the guest up first") : await post(f);
        const ok = r.status === 200 || r.status === 201;
        socket.write(record("PA", [["P#", seq], ["AS", ok ? "OK" : "NG"], ["RN", f.get("RN") ?? ""], ...(ok ? [] : [["CT", String(r.body?.message ?? "Not posted").slice(0, 30)]]), ...stamp()]), "latin1");
      }
    };

    const sockets = new Set();
    const server = net.createServer((socket) => {
      // only the till's own address
      const from = (socket.remoteAddress ?? "").replace(/^::ffff:/, "");
      if (!allowFrom.has(from)) {
        socket.destroy();
        return;
      }
      const inquired = new Set();
      sockets.add(socket);
      state.connections++;
      let buffer = "";
      socket.setEncoding("latin1");
      socket.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.length > MAX_BUFFER) buffer = "";
        for (let end = buffer.indexOf(ETX); end >= 0; end = buffer.indexOf(ETX)) {
          // anything before STX is noise on the line
          const start = buffer.lastIndexOf(STX, end);
          const text = buffer.slice(start + 1, end);
          buffer = buffer.slice(end + 1);
          state.lastMessageAt = new Date();
          if (start < 0 || start > end) continue;
          const rec = parseRecord(text);
          handle(rec, socket, inquired).catch((err) => {
            // the interface did not answer: the till hears no, not nothing
            state.lastError = err.message;
            if (rec.type === "PR" || rec.type === "PS") socket.write(record("PA", [["P#", new Map(rec.fields).get("P#") ?? ""], ["AS", "NG"], ["CT", "Interface not available"], ...stamp()]), "latin1");
          });
        }
      });
      socket.on("close", () => {
        state.connections--;
        sockets.delete(socket);
      });
      socket.on("error", () => undefined);
    });
    // a port already taken is reported in the health, not a crash of the Bridge
    server.on("error", (err) => {
      state.lastError = err.message;
    });
    server.listen(port, "0.0.0.0");

    return {
      name: "fias-till",
      async health() {
        // the till's connection, and our interface behind it
        if (Date.now() - state.reach.at > REACH_CHECK_MS) state.reach = { ok: await call("GET", "/guests?term=__health__").then((r) => r.status === 200, () => false), at: Date.now() };
        const reach = state.reach.ok;
        const till = state.connections > 0 ? `till connected (${state.connections})` : "no till connected";
        const last = state.lastMessageAt ? `, last message ${state.lastMessageAt.toISOString().slice(11, 19)}` : "";
        const error = state.lastError ? `; last error: ${state.lastError}` : "";
        return { ok: state.connections > 0 && reach, detail: `${till}${last}; interface ${reach ? "reachable" : "not reachable"}${error}` };
      },
      async stop() {
        // a new version takes the port over: the till reconnects to it
        for (const s of sockets) s.destroy();
        await new Promise((resolve) => server.close(() => resolve()));
      },
    };
  },
};
