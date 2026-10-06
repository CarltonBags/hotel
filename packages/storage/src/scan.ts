import { connect } from "node:net";

/** Virus scan of an upload before it is stored (ticket 36). */
export interface VirusScanner {
  readonly name: string;
  /** null when clean, else the name of what was found. */
  scan(bytes: Uint8Array): Promise<string | null>;
}

/** ClamAV's daemon over TCP (INSTREAM): chunks with a length prefix, then a zero chunk. */
export class ClamdScanner implements VirusScanner {
  readonly name = "clamd";
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  scan(bytes: Uint8Array): Promise<string | null> {
    return new Promise((resolvePromise, reject) => {
      const socket = connect(this.port, this.host);
      let answer = "";
      socket.setTimeout(30_000, () => socket.destroy(new Error("Virus scan timed out")));
      socket.on("error", reject);
      socket.on("data", (d) => (answer += d.toString()));
      socket.on("end", () => {
        const text = answer.replace(/\0/g, "").trim();
        if (text.endsWith("OK")) resolvePromise(null);
        else if (text.endsWith("FOUND")) resolvePromise(text.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, ""));
        else reject(new Error(`Virus scan failed: ${text}`));
      });
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let i = 0; i < bytes.length; i += 64 * 1024) {
          const chunk = bytes.subarray(i, i + 64 * 1024);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          socket.write(len);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
    });
  }
}

/** For development and tests: finds only the EICAR test signature. */
export class FakeScanner implements VirusScanner {
  readonly name = "fake";
  async scan(bytes: Uint8Array): Promise<string | null> {
    return Buffer.from(bytes).includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE") ? "Eicar-Test-Signature" : null;
  }
}
