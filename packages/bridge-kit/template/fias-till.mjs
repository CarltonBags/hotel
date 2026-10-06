// The FIAS till plugin for the Site Bridge (ticket 66): tills that expect a local interface server
// (Oracle Simphony, Vectron and others speaking FIAS) connect to it on the hotel's network; it relays
// guest lookup, postings and reversals outbound to our room charge interface (docs/room-charge-interface.md).
// Settings in the Bridge's bridge.json:
//   { "port": "5010", "api": "https://<hotel>.<our domain>/api/till/v1", "key": "hs_till_…", "subtotalRates": "1:19,2:7" }
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
    const state = { connections: 0, lastMessageAt: null, lastError: null };
    const call = async (method, path, body) => {
      const res = await fetch(`${api}${path}`, { method, headers: { authorization: `Bearer ${config.key}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    // a posting: its check number names the bill; a negative total takes that bill back
    const post = async (f) => {
      const total = Number(f.get("TA") ?? 0);
      const workstation = f.get("WS") ?? "";
      const check = f.get("CK") ?? f.get("P#") ?? "";
      const id = `fias-${workstation}-${check}`;
      if (total < 0) {
        const r = await call("POST", `/bills/${encodeURIComponent(id)}/correction`, { id: `${id}-void-${f.get("P#") ?? ""}`, receiptNumber: check, fiscalId: "" });
        return r;
      }
      // tax-inclusive subtotals per class, their discounts added; each class is a tax rate set up for this till
      const totals = new Map();
      for (let i = 1; i <= 9; i++) {
        const amount = cents(f.get(`S${i}`)) + cents(f.get(`D${i}`));
        if (!f.has(`S${i}`) && !f.has(`D${i}`)) continue;
        const rate = rates[String(i)];
        if (rate === undefined) return { status: 422, body: { error: "unknown_tax_rate", message: `No tax rate for subtotal ${i}` } };
        totals.set(rate, Math.round(((totals.get(rate) ?? 0) + amount) * 100) / 100);
      }
      return call("POST", "/bills", { id, reservationId: f.get("G#") ?? "", receiptNumber: check, fiscalId: "", totals: [...totals].map(([taxRate, amount]) => ({ taxRate, amount })), tip: cents(f.get("TP")) });
    };

    const handle = async (rec, socket) => {
      const f = new Map(rec.fields);
      const seq = f.get("P#") ?? "";
      if (rec.type === "LS") {
        socket.write(record("LS", stamp()));
        socket.write(record("LA", stamp()));
        return;
      }
      if (rec.type === "LA") return;
      // an inquiry: the checked-in guests the till may charge, room or name
      if (rec.type === "PR" && f.has("PI")) {
        const r = await call("GET", `/guests?term=${encodeURIComponent(f.get("PI") ?? "")}`);
        if (r.status !== 200) {
          socket.write(record("PA", [["P#", seq], ["AS", "NG"], ["CT", "Interface not available"], ...stamp()]));
          return;
        }
        const fields = [["P#", seq]];
        for (const g of r.body.guests) fields.push(["RN", g.room ?? ""], ["G#", g.reservationId], ["GN", `${g.lastName}, ${g.firstName}`.slice(0, 40)], ["CL", String(Math.round(g.remainingLimit * 100))]);
        socket.write(record("PL", [...fields, ...stamp()]));
        return;
      }
      if (rec.type === "PS" || (rec.type === "PR" && f.has("TA"))) {
        const r = await post(f);
        const ok = r.status === 200 || r.status === 201;
        socket.write(record("PA", [["P#", seq], ["AS", ok ? "OK" : "NG"], ["RN", f.get("RN") ?? ""], ...(ok ? [] : [["CT", String(r.body?.message ?? "Not posted").slice(0, 30)]]), ...stamp()]));
      }
    };

    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      state.connections++;
      let buffer = "";
      socket.setEncoding("latin1");
      socket.on("data", (chunk) => {
        buffer += chunk;
        for (let end = buffer.indexOf(ETX); end >= 0; end = buffer.indexOf(ETX)) {
          const start = buffer.indexOf(STX);
          const text = buffer.slice(start + 1, end);
          buffer = buffer.slice(end + 1);
          state.lastMessageAt = new Date();
          handle(parseRecord(text), socket).catch((err) => {
            state.lastError = err.message;
          });
        }
      });
      socket.on("close", () => {
        state.connections--;
        sockets.delete(socket);
      });
      socket.on("error", () => undefined);
    });
    server.listen(port, "0.0.0.0");

    return {
      name: "fias-till",
      async health() {
        // the till's connection, and our interface behind it
        const reach = await call("GET", "/guests?term=__health__").then((r) => r.status === 200, () => false);
        const till = state.connections > 0 ? `till connected (${state.connections})` : "no till connected";
        const last = state.lastMessageAt ? `, last message ${state.lastMessageAt.toISOString().slice(11, 19)}` : "";
        return { ok: state.connections > 0 && reach, detail: `${till}${last}; interface ${reach ? "reachable" : "not reachable"}` };
      },
      async stop() {
        // a new version takes the port over: the till reconnects to it
        for (const s of sockets) s.destroy();
        await new Promise((resolve) => server.close(() => resolve()));
      },
    };
  },
};
