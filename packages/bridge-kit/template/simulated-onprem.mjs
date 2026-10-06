// A Lock Plugin for the Site Bridge, written as the plugin kit's template: copy it for a new vendor,
// replace the calls to the simulated lock server with the vendor's own interface, run the harness.
// The Bridge loads this file as an ES module; its default export describes the plugin.

class LockUnavailable extends Error {}

export default {
  name: "simulated-onprem",
  version: "1.0.0",
  kind: "lock",
  // offline card locks: cards on encoders, read back; a revoked card is only blocked at the lock server
  capabilities: { card: true, pin: false, phoneKey: false, remoteRevoke: false, readCard: true, encoders: true },
  create(config) {
    const base = String(config.server ?? "").replace(/\/$/, "");
    const call = async (method, path, body) => {
      let res;
      try {
        res = await fetch(`${base}${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
      } catch (err) {
        throw new LockUnavailable(`Lock server did not answer: ${err.message}`);
      }
      if (res.status === 404 && method === "GET") return null;
      if (!res.ok) throw new LockUnavailable(`Lock server answered ${res.status}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    };
    return {
      name: "simulated-onprem",
      capabilities: this.capabilities,
      async issueKey(r) {
        if (r.kind !== "card" || !r.encoderId) throw new Error("This lock system writes key cards on an encoder");
        const made = await call("POST", "/keys", { door: r.lockRef, encoder: r.encoderId, validUntil: r.validUntil.toISOString(), name: `hs-${r.keyId}` });
        return { externalId: made.id };
      },
      async updateKey(externalId, r) {
        await call("PATCH", `/keys/${encodeURIComponent(externalId)}`, { validUntil: r.validUntil.toISOString() });
      },
      async revokeKey(externalId) {
        await call("POST", `/keys/${encodeURIComponent(externalId)}/block`);
      },
      async revokeByKeyId() {
        // the simulated server cannot find a key by our name: nothing to do
      },
      async readCard(encoderId) {
        const card = await call("GET", `/encoders/${encodeURIComponent(encoderId)}/card`);
        return card ? { lockRef: card.door, validUntil: new Date(card.validUntil), externalId: card.id } : null;
      },
      async listEncoders() {
        return (await call("GET", "/encoders")) ?? [];
      },
      async health() {
        try {
          const s = await call("GET", "/status");
          return { ok: !!s?.ok, detail: `lock server, ${s?.doors ?? 0} doors` };
        } catch (err) {
          return { ok: false, detail: err.message };
        }
      },
    };
  },
};
