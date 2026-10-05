"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { fillQuickReply, type QuickReplyValues } from "@hoteloftware/domain";
import type { FormState } from "@/lib/form";
import { DATA_EVENT } from "@/shell/LiveRefresh";
import { useShell } from "@/shell/ShellProvider";
import { seenAction, sendMessageAction, typingAction } from "./actions";

/** Opening the Conversation up to its latest guest message clears unread (ticket 42). */
export function SeenMarker({ propertyId, conversationId, messageId }: { propertyId: string; conversationId: string; messageId: string }) {
  useEffect(() => {
    void seenAction(propertyId, conversationId, messageId);
  }, [propertyId, conversationId, messageId]);
  return null;
}

/** A colleague writing in this Conversation, live. */
export function TypingIndicator({ conversationId }: { conversationId: string }) {
  const { t, user } = useShell();
  const [who, setWho] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onData = (e: Event) => {
      const d = (e as CustomEvent<{ kind: string; title?: string }>).detail;
      if (d.kind !== "data.typing" || !d.title) return;
      try {
        const x = JSON.parse(d.title) as { c: string; u: string; n: string };
        if (x.c !== conversationId || x.u === user.id) return;
        setWho(x.n);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setWho(null), 6000);
      } catch {
        // not ours
      }
    };
    window.addEventListener(DATA_EVENT, onData);
    return () => {
      window.removeEventListener(DATA_EVENT, onData);
      if (timer) clearTimeout(timer);
    };
  }, [conversationId, user.id]);
  return who ? (
    <p className="text-[12px] text-ink-60" data-typing>
      {t("inbox.typing", { name: who })}
    </p>
  ) : null;
}

/** Write to the guest or an Internal Note; a Quick Reply fills in what is known; colleagues see that one is writing. */
export function Composer({
  propertyId,
  conversationId,
  quickReplies,
  values,
}: {
  propertyId: string;
  conversationId: string;
  quickReplies: { id: string; title: string; body: string }[];
  values: QuickReplyValues;
}) {
  const { t } = useShell();
  const [state, run, pending] = useActionState<FormState, FormData>(sendMessageAction, {});
  const form = useRef<HTMLFormElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  const typing = () => {
    // now and then, not on every key
    if (Date.now() - lastTyping.current < 3000) return;
    lastTyping.current = Date.now();
    void typingAction(propertyId, conversationId);
  };
  return (
    <form ref={form} action={run} className="grid gap-2 border-t border-ink-10 pt-3" data-composer>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      {quickReplies.length ? (
        <select
          aria-label={t("inbox.quickReply")}
          className="h-10 rounded-xl bg-surface-2 px-3 text-sm"
          defaultValue=""
          data-quick-reply
          onChange={(e) => {
            const q = quickReplies.find((x) => x.id === e.target.value);
            if (q && text.current) text.current.value = fillQuickReply(q.body, values);
            e.target.value = "";
          }}
        >
          <option value="">{t("inbox.quickReply")}…</option>
          {quickReplies.map((q) => (
            <option key={q.id} value={q.id}>
              {q.title}
            </option>
          ))}
        </select>
      ) : null}
      <textarea ref={text} name="body" rows={3} maxLength={5000} placeholder={t("inbox.placeholder")} onInput={typing} className="rounded-xl bg-surface-2 p-3 text-sm" />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="hidden" name="note" value="off" />
          <input type="checkbox" name="note" /> {t("inbox.noteToggle")}
        </label>
        <label className="flex items-center gap-2 text-ink-60">
          <span>{t("inbox.attach")}</span>
          <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" />
        </label>
        <button type="submit" disabled={pending} className="ml-auto h-10 rounded-full bg-accent px-5 font-medium text-white disabled:opacity-50">
          {t("inbox.send")}
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
