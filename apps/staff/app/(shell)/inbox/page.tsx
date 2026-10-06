import Link from "next/link";
import { conversationProperty, conversationRooms, conversationView, modulePeriods, listConversations, listQuickReplies, type ThreadMessage } from "@hoteloftware/db";
import { DATA_KINDS, can, moduleState, moduleVisible, todayIn } from "@hoteloftware/domain";
import { ActionForm } from "@/components/form-fields";
import { fill, type Messages } from "@/i18n/messages";
import { requireAllowed, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { fileLink } from "@/lib/files";
import { loadShell } from "@/lib/shell";
import { LiveRefresh } from "@/shell/LiveRefresh";
import { claimAction, disputeAction, messageToTaskAction } from "./actions";
import { Composer, SeenMarker, TypingIndicator } from "./inbox-client";

/**
 * The Guest Inbox of the property in the navbar (ticket 42): Conversations,
 * unread first, with waiting time and who handles them; the open one with the
 * guest's earlier stays, Quick Replies, Internal Notes and attachments.
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  // one property, or with "All properties" every one whose inbox the user works, combined (ticket 43)
  const inView = shell.properties.filter((p) => !shell.scope || shell.scope === "all" || p.id === shell.scope);
  const { tenant, session, actor } = await requirePrincipal();
  // where the user works the inbox and the Guest Portal Module is on
  const periods = await modulePeriods(pool(), tenant.schemaName, inView.map((p) => p.id));
  const allowed = inView.filter((p) => can(actor, "use_guest_inbox", p.id) && moduleVisible(moduleState(periods.get(p.id) ?? [], "guest_portal", todayIn(p.timeZone))));
  if (!allowed.length) {
    if (inView[0]) await requireAllowed("use_guest_inbox", inView[0].id);
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.guest_inbox"]}</h1>
        <p className="mt-2 text-ink-60">{m["dev.pickProperty"]}</p>
      </div>
    );
  }
  const combined = allowed.length > 1;
  const ids = allowed.map((p) => p.id);
  const open = (await searchParams).c ?? "";
  const openAt = open ? await conversationProperty(pool(), tenant.schemaName, open, ids) : null;
  const property = allowed.find((p) => p.id === openAt) ?? allowed[0]!;
  const [list, view, replies, rooms] = await Promise.all([
    listConversations(pool(), tenant.schemaName, ids),
    openAt ? conversationView(pool(), tenant.schemaName, openAt, open) : Promise.resolve(null),
    openAt ? listQuickReplies(pool(), tenant.schemaName, openAt) : Promise.resolve([]),
    openAt ? conversationRooms(pool(), tenant.schemaName, openAt, open) : Promise.resolve([]),
  ]);
  const zoneOf = new Map(allowed.map((p) => [p.id, p.timeZone]));
  const keeps = can(actor, "keep_conversations", property.id);
  const locale = language === "de" ? "de-DE" : "en-GB";
  // each hotel's own clock
  const when = (d: Date, at = property.id) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: zoneOf.get(at) ?? property.timeZone }).format(d);
  const day = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const waited = (since: Date) => {
    const min = Math.max(0, Math.round((Date.now() - since.getTime()) / 60_000));
    return min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${Math.floor(min / 1440)} d`;
  };
  const file = (id: string) => fileLink(tenant.id, session.user.id, id);
  const languageReplies = view ? replies.filter((q) => q.language === view.language) : [];
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(16rem,22rem)_1fr]" data-inbox>
      <LiveRefresh kind={DATA_KINDS.conversations} propertyIds={ids} />
      <aside className="min-h-0 overflow-auto border-r border-ink-10 p-3">
        <h1 className="px-2 pb-2 text-lg font-medium">
          {m["module.guest_inbox"]} <span className="text-ink-60">· {combined ? m["shell.allProperties"] : property.name}</span>
        </h1>
        {list.length === 0 ? <p className="px-2 text-sm text-ink-60">{m["inbox.empty"]}</p> : null}
        <ul className="grid gap-1">
          {list.map((c) => (
            <li key={c.id}>
              <Link href={`/inbox?c=${c.id}`} data-conversation={c.id} data-unread={c.unread || undefined} className={`grid gap-0.5 rounded-xl px-3 py-2 text-sm ${c.id === open ? "bg-ink-10" : "hover:bg-ink-5"}`}>
                <span className="flex items-center gap-2">
                  {c.unread ? <span aria-label={m["inbox.unread"]} className="size-2 shrink-0 rounded-full bg-accent" /> : null}
                  <span className={`truncate ${c.unread ? "font-semibold" : "font-medium"}`}>{c.guestName || c.confirmationNumber}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-ink-60">{c.lastMessageAt ? when(c.lastMessageAt, c.propertyId) : ""}</span>
                </span>
                <span className="truncate text-[12px] text-ink-60">
                  {combined ? <span data-hotel>{c.propertyName} · </span> : null}
                  {c.confirmationNumber} · {day(c.arrival)} – {day(c.departure)}
                  {c.room ? ` · ${c.room}` : ""}
                </span>
                <span className="truncate text-[12px]">{c.lastText}</span>
                <span className="flex gap-2 text-[11px] text-ink-60">
                  {c.waitingSince ? <span className="text-warning" data-waiting>{fill(m["inbox.waiting"], { time: waited(c.waitingSince) })}</span> : null}
                  {c.claimedName ? <span data-claimed>{fill(m["inbox.handledBy"], { name: c.claimedName })}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-h-0 flex-col p-4">
        {!view ? (
          <p className="text-ink-60">{m["inbox.pick"]}</p>
        ) : (
          <>
            {view.latestGuestMessageId ? <SeenMarker propertyId={property.id} conversationId={view.conversation.id} messageId={view.latestGuestMessageId} /> : null}
            <header className="flex flex-wrap items-center gap-3 border-b border-ink-10 pb-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-medium">{view.conversation.guestName || view.conversation.confirmationNumber}</h2>
                <p className="text-sm text-ink-60">
                  {view.conversation.confirmationNumber} · {day(view.conversation.arrival)} – {day(view.conversation.departure)}
                  {view.conversation.room ? ` · ${view.conversation.room}` : ""}
                  {view.conversation.reservationId ? (
                    <>
                      {" · "}
                      <Link href={`/reservations/${view.conversation.reservationId}`} className="underline">
                        {m["inbox.reservation"]}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2 text-sm">
                {view.conversation.disputed ? <span data-disputed className="rounded-full bg-warning/20 px-2 py-0.5 text-[12px]">{m["inbox.disputed"]}</span> : null}
                {view.conversation.claimedName ? <span data-claimed>{fill(m["inbox.handledBy"], { name: view.conversation.claimedName })}</span> : null}
                {keeps ? (
                  <ActionForm action={disputeAction} submitLabel={view.conversation.disputed ? m["inbox.disputeEnd"] : m["inbox.dispute"]} className="flex">
                    <input type="hidden" name="propertyId" value={property.id} />
                    <input type="hidden" name="conversationId" value={view.conversation.id} />
                    {view.conversation.disputed ? null : <input type="hidden" name="disputed" value="on" />}
                  </ActionForm>
                ) : null}
                <ActionForm action={claimAction} submitLabel={view.conversation.claimedBy === session.user.id ? m["inbox.release"] : m["inbox.claim"]} className="flex">
                  <input type="hidden" name="propertyId" value={property.id} />
                  <input type="hidden" name="conversationId" value={view.conversation.id} />
                  {view.conversation.claimedBy === session.user.id ? <input type="hidden" name="release" value="1" /> : null}
                </ActionForm>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-auto py-3">
              {view.earlier.length ? (
                <details className="mb-3 rounded-xl bg-surface-2 p-3 text-sm" data-earlier>
                  <summary className="cursor-pointer font-medium">
                    {m["inbox.earlier"]} ({view.earlier.length})
                  </summary>
                  {view.earlier.map((e) => (
                    <div key={e.conversation.id} className="mt-3 grid gap-2 opacity-80">
                      <p className="text-[12px] text-ink-60">
                        {e.conversation.confirmationNumber} · {day(e.conversation.arrival)} – {day(e.conversation.departure)}
                      </p>
                      <Thread messages={e.messages} m={m} when={when} file={file} />
                    </div>
                  ))}
                </details>
              ) : null}
              <Thread messages={view.messages} m={m} when={when} file={file} toWork={{ propertyId: property.id, rooms }} />
            </div>
            <TypingIndicator conversationId={view.conversation.id} />
            <Composer propertyId={property.id} conversationId={view.conversation.id} seenUpTo={view.latestGuestMessageId} quickReplies={languageReplies} values={view.values} />
          </>
        )}
      </section>
    </div>
  );
}

/** The thread; on the open Conversation (not earlier stays) a guest message can become work for the room. */
function Thread({ messages, m, when, file, toWork }: { messages: ThreadMessage[]; m: Messages; when: (d: Date) => string; file: (id: string) => string; toWork?: { propertyId: string; rooms: { id: string; number: string }[] } }) {
  // with several rooms (a Booker's Conversation) staff name the room
  const roomChoice = toWork && toWork.rooms.length > 1 ? (
    <select name="roomId" required className="h-8 rounded-lg bg-surface px-2" aria-label="Room">
      {toWork.rooms.map((r) => (
        <option key={r.id} value={r.id}>
          {r.number}
        </option>
      ))}
    </select>
  ) : null;
  return (
    <ol className="grid gap-2" data-thread>
      {messages.map((x) => (
        <li
          key={x.id}
          data-message={x.kind}
          className={`grid max-w-[80%] gap-1 rounded-2xl px-4 py-2 text-sm ${
            x.kind === "guest" ? "bg-surface-2" : x.kind === "note" ? "justify-self-end bg-warning/20" : x.kind === "auto" ? "bg-ink-5 text-ink-80" : "justify-self-end bg-accent/15"
          }`}
        >
          <span className="text-[11px] text-ink-60">
            {x.kind === "auto" ? m["inbox.auto"] : x.kind === "note" ? `${m["inbox.note"]} · ${x.authorName}` : x.authorName} · {when(x.at)}
            {x.notSent ? ` · ${m["inbox.notSent"]}` : ""}
            {x.byEmail ? ` · ${m["inbox.byEmail"]}` : ""}
          </span>
          {x.subject ? <span className="font-medium">{x.subject}</span> : null}
          {x.body ? <span className="whitespace-pre-wrap">{x.body}</span> : null}
          {x.fileId ? (
            x.fileType === "application/pdf" ? (
              <a href={file(x.fileId)} target="_blank" rel="noreferrer" className="underline" data-pdf>
                {m["inbox.pdf"]}
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file(x.fileId)} alt="" className="max-h-64 rounded-xl" />
            )
          ) : null}
          {x.kind === "guest" && toWork ? (
            <span className="flex flex-wrap items-center gap-2 text-[12px]" data-work>
              {x.issueId ? (
                <Link href={`/maintenance#issue-${x.issueId}`} className="underline" data-issue>
                  {m["inbox.issueMade"]}
                </Link>
              ) : (
                <ActionForm action={messageToTaskAction} submitLabel={m["inbox.toIssue"]} className="flex gap-1">
                  <input type="hidden" name="propertyId" value={toWork.propertyId} />
                  <input type="hidden" name="messageId" value={x.id} />
                  <input type="hidden" name="kind" value="maintenance" />
                  {roomChoice}
                </ActionForm>
              )}
              {x.taskId ? (
                <Link href={`/housekeeping#task-${x.taskId}`} className="underline" data-task>
                  {m["inbox.taskMade"]}
                </Link>
              ) : (
                <ActionForm action={messageToTaskAction} submitLabel={m["inbox.toTask"]} className="flex gap-1">
                  <input type="hidden" name="propertyId" value={toWork.propertyId} />
                  <input type="hidden" name="messageId" value={x.id} />
                  <input type="hidden" name="kind" value="housekeeping" />
                  {roomChoice}
                </ActionForm>
              )}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
