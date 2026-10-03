"use client";

import { useState } from "react";
import type { Messages } from "@/i18n/messages";

const button = "h-9 rounded-full px-4 text-sm font-medium";
const secondary = `${button} border border-ink-10 bg-surface hover:bg-ink-5`;
const input = "h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm";

/**
 * An action beyond the user's limit (ticket 31): ask a Property Manager
 * remotely, or let one approve here with their own username and password.
 */
export function ApprovalPrompt({
  summary,
  pending,
  onRequest,
  onCredentials,
  m,
}: {
  summary: string;
  pending: boolean;
  onRequest: () => void;
  onCredentials: (username: string, password: string) => void;
  m: Messages;
}) {
  const [here, setHere] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div role="group" aria-label={m["appr.needed"]} className="grid w-full gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
      <p>
        <strong>{m["appr.needed"]}</strong> · {summary}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={onRequest} className={secondary}>
          {m["appr.ask"]}
        </button>
        <button type="button" disabled={pending} onClick={() => setHere(!here)} aria-expanded={here} className={secondary}>
          {m["appr.here"]}
        </button>
      </div>
      {here ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onCredentials(username, password);
            setPassword("");
          }}
        >
          <label className="grid gap-1 text-xs text-ink-60">
            {m["appr.managerUsername"]}
            <input name="approver" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} className={input} />
          </label>
          <label className="grid gap-1 text-xs text-ink-60">
            {m["appr.managerPassword"]}
            <input name="approverPassword" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
          </label>
          <button type="submit" disabled={pending || !username || !password} className={`${button} bg-accent text-white disabled:opacity-60`}>
            {m["appr.approveHere"]}
          </button>
        </form>
      ) : null}
    </div>
  );
}
