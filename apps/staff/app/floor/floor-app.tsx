"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Accessibility, Baby, BedDouble, BedSingle, Camera, CameraOff, ChevronRight, CircleAlert, Clock, Feather, Gift, Hourglass, Languages, Layers, Lock, LogIn, LogOut, Minus, PackageSearch, PawPrint, Plus, Sparkles, Star, StickyNote, Wrench, X } from "lucide-react";
import { FLOOR_LANGUAGES, LOST_PICKS, PROBLEM_PICKS, URGENCIES, floorSections, isRtl, type FloorLanguage, type HousekeepingNoteCode, type LostPick, type PhoneOp, type ProblemPick, type Urgency } from "@hoteloftware/domain";
import type { FloorDay, FloorIssue, FloorTask, PhoneChangeOutcome } from "@hoteloftware/db";
import { FLOOR_LANGUAGE_NAMES, fillFloor, type FloorKey, type FloorMessages } from "@/i18n/floor";
import { lockDeviceAction } from "@/app/device/actions";
import { setFloorLanguageAction } from "./actions";
import { load, save, update } from "./store";

/** A change waiting to send, with the key that says whose it is. */
interface Pending {
  op: PhoneOp;
  key: string | null;
  userId: string;
}

const KIND_STYLE: Record<FloorTask["kind"], { Icon: typeof LogOut; tone: string }> = {
  departure: { Icon: LogOut, tone: "bg-[#fde8e1] text-[#e2552b]" },
  stayover: { Icon: BedDouble, tone: "bg-[#e1edfd] text-[#0071e3]" },
  arrival: { Icon: LogIn, tone: "bg-[#def5ea] text-[#1fa971]" },
  linen: { Icon: Layers, tone: "bg-[#ece6ff] text-[#7c5cff]" },
  clean: { Icon: Sparkles, tone: "bg-[#fdf1d8] text-[#b98900]" },
};

/** The property's fixed list of Housekeeping Notes, each with its icon and colour. */
const NOTE_STYLE: Record<HousekeepingNoteCode, { Icon: typeof LogOut; tone: string }> = {
  feather_allergy: { Icon: Feather, tone: "text-danger" },
  baby_cot: { Icon: Baby, tone: "text-[#0aa5a5]" },
  extra_bed: { Icon: BedSingle, tone: "text-[#0071e3]" },
  welcome_gift: { Icon: Gift, tone: "text-[#e0457b]" },
  late_checkout: { Icon: Clock, tone: "text-warning" },
  pet: { Icon: PawPrint, tone: "text-[#b98900]" },
  accessibility: { Icon: Accessibility, tone: "text-[#7c5cff]" },
};

/** A batch the server takes at once; photos make changes large. */
const BATCH = 10;

/**
 * The phone view (ticket 35, variant A "List by section"): the user's rooms
 * by Section, a room sheet, Maintenance's queue. Every change is kept on the
 * phone first and sent when there is a connection.
 */
export function FloorApp(props: {
  userId: string;
  userName: string;
  initial: FloorDay;
  changeKey: string | null;
  language: FloorLanguage;
  m: FloorMessages;
  names: Record<string, string>;
  onDevice: boolean;
  boardHref: string | null;
}) {
  const { m, userId } = props;
  const [day, setDay] = useState<FloorDay>(props.initial);
  const [pending, setPending] = useState<Pending[]>([]);
  const [online, setOnline] = useState(true);
  const [notices, setNotices] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [langOpen, setLangOpen] = useState(false);
  const sending = useRef(false);
  const t = useCallback((k: FloorKey, v?: Record<string, string | number>) => (v ? fillFloor(m[k], v) : m[k]), [m]);
  // the flush reads the latest day without being re-made on each change
  const dayRef = useRef(day);
  dayRef.current = day;

  // keep the day and the change key on the phone for the time without connection
  useEffect(() => {
    void load<Pending[]>("outbox").then((p) => setPending(p ?? []));
  }, []);

  /** Keep the day as the phone shows it, for opening without a connection. */
  const keepDay = useCallback((next: FloorDay) => {
    void update<{ day?: FloorDay } & Record<string, unknown>>("boot", (b) => ({ ...(b ?? {}), day: next }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/floor/day", { cache: "no-store" });
      if (!res.ok) return;
      const fresh = (await res.json()) as FloorDay;
      setDay(fresh);
      keepDay(fresh);
    } catch {
      // offline: the kept day stays
    }
  }, [keepDay]);

  /** Send what waits, oldest first, each under its own user's key, a few at a time. */
  const flush = useCallback(async () => {
    if (sending.current) return;
    const queue = (await load<Pending[]>("outbox")) ?? [];
    if (!queue.length) return;
    sending.current = true;
    const done = new Set<string>();
    try {
      const groups = new Map<string, Pending[]>();
      for (const p of queue) groups.set(p.key ?? `session:${p.userId}`, [...(groups.get(p.key ?? `session:${p.userId}`) ?? []), p]);
      for (const list of groups.values()) {
        // made without a key by someone else (no enrolled Device): waits until they are signed in again
        const notMine = list[0]!.key === null && list[0]!.userId !== userId;
        if (notMine) continue;
        for (let i = 0; i < list.length; i += BATCH) {
          const batch = list.slice(i, i + BATCH);
          const res = await fetch("/api/floor/changes", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: batch[0]!.key, changes: batch.map((p) => p.op) }),
          });
          if (res.status === 403) {
            // the key ran out or the Device was revoked: these can no longer be sent under their user
            for (const p of list) done.add(p.op.id);
            setNotices((n) => [...n, t("refused", { message: String(res.status) })]);
            break;
          }
          if (!res.ok) break; // try again later
          const { results } = (await res.json()) as { results: ({ id: string } & PhoneChangeOutcome)[] };
          for (const r of results) {
            done.add(r.id);
            const op = batch.find((p) => p.op.id === r.id)?.op;
            if (r.outcome === "conflict" && op?.kind === "task") {
              const task = dayRef.current.tasks.find((x) => x.id === op.taskId);
              setNotices((n) => [...n, t("conflict", { room: task?.roomNumber ?? "" })]);
            } else if (r.outcome === "refused") setNotices((n) => [...n, t("refused", { message: r.message })]);
          }
        }
      }
    } catch {
      // still offline
    } finally {
      if (done.size) setPending(await update<Pending[]>("outbox", (q) => (q ?? []).filter((p) => !done.has(p.op.id))));
      sending.current = false;
    }
    if (done.size) await refresh();
  }, [refresh, t, userId]);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    // what waits is tried again every few seconds (the "online" event can come before the network works); the day every half minute
    const retry = setInterval(() => {
      if (navigator.onLine) void flush();
    }, 5_000);
    const timer = setInterval(() => {
      if (navigator.onLine) void refresh();
    }, 30_000);
    void flush();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(timer);
      clearInterval(retry);
    };
  }, [flush, refresh]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.register("/floor-sw.js", { scope: "/floor" }).catch(() => undefined);
  }, []);

  /** Keep a change on the phone, show it at once, send it when possible. */
  const record = useCallback(
    async (op: PhoneOp, local?: (d: FloorDay) => FloorDay) => {
      setPending(await update<Pending[]>("outbox", (q) => [...(q ?? []), { op, key: props.changeKey, userId }]));
      if (local) {
        setDay((d) => {
          const next = local(d);
          keepDay(next);
          return next;
        });
      }
      if (navigator.onLine) void flush();
    },
    [flush, keepDay, props.changeKey, userId],
  );

  const newOp = () => ({ id: crypto.randomUUID(), at: new Date().toISOString() });
  const taskStep = (task: FloorTask, step: "start" | "done" | "undo" | "declined" | "dnd") => {
    const STATUS_AFTER: Record<typeof step, FloorTask["status"]> = { start: "in_progress", done: "done", undo: task.started ? "in_progress" : "open", declined: "skipped", dnd: "skipped" };
    const status = STATUS_AFTER[step];
    void record({ ...newOp(), kind: "task", taskId: task.id, step, seen: task.version }, (d) => ({
      ...d,
      tasks: d.tasks.map((x) => (x.id === task.id ? { ...x, status, started: x.started || step === "start", skipReason: step === "declined" || step === "dnd" ? step : null, doneBy: step === "start" || step === "undo" ? (step === "undo" ? null : x.doneBy) : userId } : x)),
    }));
  };

  const waitingIds = useMemo(() => new Set(pending.flatMap((p) => ("taskId" in p.op ? [p.op.taskId] : "roomId" in p.op ? [p.op.roomId] : "issueId" in p.op ? [p.op.issueId] : []))), [pending]);
  const mine = pending.filter((p) => p.userId === userId).length;
  const done = day.tasks.filter((x) => x.status === "done" || x.status === "skipped").length;
  const left = day.tasks.filter((x) => x.status === "open" || x.status === "in_progress").reduce((s, x) => s + x.minutes, 0);
  const sheet = day.tasks.find((x) => x.id === open) ?? null;
  const initials = props.userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2);

  return (
    <div dir={isRtl(props.language) ? "rtl" : "ltr"} lang={props.language} className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 bg-canvas px-4 pt-5 pb-24 text-ink">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-accent font-medium text-white">{initials}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{day.issues && !day.tasks.length ? t("title.problems") : t("title.rooms")}</h1>
          {day.tasks.length ? <p className="text-sm text-ink-60">{t("progress", { done, total: day.tasks.length, min: left })}</p> : null}
        </div>
        <button type="button" onClick={() => setLangOpen((v) => !v)} aria-label={t("language")} className="flex h-9 items-center gap-1 rounded-full bg-surface px-3 text-sm shadow-card">
          <Languages className="size-4" /> {props.language.toUpperCase()}
        </button>
        {props.onDevice ? (
          <button type="button" onClick={() => void lockDeviceAction()} aria-label={t("lock")} className="grid size-9 place-items-center rounded-full bg-surface shadow-card">
            <Lock className="size-4" />
          </button>
        ) : null}
      </header>

      {langOpen ? (
        <div role="listbox" aria-label={t("language")} className="grid grid-cols-2 gap-2 rounded-2xl bg-surface p-3 shadow-card">
          {FLOOR_LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              role="option"
              aria-selected={l === props.language}
              onClick={() => void setFloorLanguageAction(l).then(() => location.reload())}
              className={`rounded-xl px-3 py-2 text-start text-sm ${l === props.language ? "bg-accent text-white" : "bg-surface-2"}`}
            >
              {FLOOR_LANGUAGE_NAMES[l]}
            </button>
          ))}
        </div>
      ) : null}

      {!online ? (
        <p role="status" className="rounded-2xl bg-warning/15 px-4 py-2 text-sm">
          {t("offline")}
        </p>
      ) : null}
      {mine ? (
        <p role="status" data-waiting={mine} className="text-sm text-ink-60">
          {t("waiting", { n: mine })}
        </p>
      ) : null}
      {notices.map((n, i) => (
        <div key={i} role="alert" className="flex items-start gap-2 rounded-2xl bg-danger/15 px-4 py-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{n}</span>
          <button type="button" aria-label={t("close")} onClick={() => setNotices((all) => all.filter((_, j) => j !== i))}>
            <X className="size-4" />
          </button>
        </div>
      ))}

      {day.issues ? <Issues issues={day.issues} t={t} names={props.names} waiting={waitingIds} onStep={(issue, step) => void record({ ...newOp(), kind: "issue", issueId: issue.id, step, note: "" })} /> : null}

      {!day.published && !day.tasks.length && !day.issues ? <p className="text-ink-60">{t("notPublished")}</p> : null}
      {day.published && !day.tasks.length && !day.issues ? <p className="text-ink-60">{t("noRooms")}</p> : null}

      {floorSections(day.tasks).map((group) => (
        <section key={group.section ?? "-"} className="grid gap-2">
          <h2 className="text-xs font-medium tracking-wide text-ink-60 uppercase">{group.section ?? t("otherRooms")}</h2>
          {group.tasks.map((task) => {
            const { Icon, tone } = KIND_STYLE[task.kind];
            return (
              <button key={task.id} type="button" data-room={task.roomNumber} data-status={task.status} onClick={() => setOpen(task.id)} className={`flex items-center gap-3 rounded-2xl bg-surface p-3 text-start shadow-card ${task.status === "done" || task.status === "skipped" ? "opacity-60" : ""}`}>
                <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${tone}`}>
                  <Icon className="size-6" />
                </span>
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold">{task.roomNumber}</span>
                    <span className="text-sm text-ink-60">
                      {t(`kind.${task.kind}`)} · {task.minutes}′
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-xs">
                    {task.guest ? <span className="text-sm text-ink-60">{task.guest.surname}</span> : null}
                    {task.priority ? (
                      <span className="flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-danger">
                        <Hourglass className="size-3" /> {t("flag.waiting")}
                      </span>
                    ) : null}
                    {task.guest?.vip ? (
                      <span className="flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5">
                        <Star className="size-3" /> {t("flag.vip")}
                      </span>
                    ) : null}
                    {task.changed ? <span className="rounded-full bg-accent px-2 py-0.5 text-white">{t("flag.changed")}</span> : null}
                    {waitingIds.has(task.id) || waitingIds.has(task.roomId) ? <span className="rounded-full bg-ink-10 px-2 py-0.5">{t("flag.pending")}</span> : null}
                    {task.status !== "open" ? <span className="rounded-full bg-surface-2 px-2 py-0.5">{t(`status.${task.status}`)}</span> : null}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-ink-60 rtl:rotate-180" />
              </button>
            );
          })}
        </section>
      ))}

      {props.boardHref ? (
        <a href={props.boardHref} className="text-center text-sm text-accent">
          {t("board")}
        </a>
      ) : null}

      {sheet ? (
        <RoomSheet
          task={sheet}
          day={day}
          t={t}
          language={props.language}
          userId={userId}
          onClose={() => setOpen(null)}
          onStep={(step) => taskStep(sheet, step)}
          onMinibar={(items) => void record({ ...newOp(), kind: "minibar", roomId: sheet.roomId, items })}
          onProblem={(p) => void record({ ...newOp(), kind: "problem", roomId: sheet.roomId, ...p })}
          onLost={(p) => void record({ ...newOp(), kind: "lost", roomId: sheet.roomId, ...p })}
        />
      ) : null}
    </div>
  );
}

type T = (k: FloorKey, v?: Record<string, string | number>) => string;

function Issues({ issues, t, names, waiting, onStep }: { issues: FloorIssue[]; t: T; names: Record<string, string>; waiting: Set<string>; onStep: (issue: FloorIssue, step: "take" | "fixed") => void }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const list = issues.filter((i) => !gone.has(i.id));
  if (!list.length) return <p className="text-ink-60">{t("noProblems")}</p>;
  const badge: Record<Urgency, string> = { now: "bg-danger/15 text-danger", today: "bg-warning/20", later: "bg-ink-10" };
  return (
    <section aria-label={t("title.problems")} className="grid gap-3">
      {list.map((i) => (
        <article key={i.id} data-issue={i.roomNumber ?? i.place} className="grid gap-2 rounded-2xl bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{i.roomNumber ?? i.place}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase ${badge[i.urgency]}`}>{t(`urgency.${i.urgency}`)}</span>
            {i.block ? <span className="rounded-full bg-ink px-2 py-0.5 text-xs text-canvas">{t(`block.${i.block}`)}</span> : null}
            {waiting.has(i.id) ? <span className="rounded-full bg-ink-10 px-2 py-0.5 text-xs">{t("flag.pending")}</span> : null}
          </div>
          <p>
            {t(`pick.${i.pick}`)}
            {i.note ? ` · ${i.note}` : ""}
          </p>
          <p className="text-xs text-ink-60">{t("reportedBy", { name: names[i.reportedBy] ?? "?" })}</p>
          {i.hasPhoto ? <img src={`/floor-photo/issue/${i.id}`} alt="" className="max-h-48 rounded-xl object-cover" /> : null}
          <div className="grid grid-cols-2 gap-2">
            {i.status === "open" && !taken.has(i.id) ? (
              <button type="button" onClick={() => (onStep(i, "take"), setTaken((s) => new Set(s).add(i.id)))} className="h-12 rounded-full bg-accent font-medium text-white">
                {t("take")}
              </button>
            ) : null}
            <button type="button" onClick={() => (onStep(i, "fixed"), setGone((s) => new Set(s).add(i.id)))} className={`h-12 rounded-full bg-[#1fa971] font-medium text-white ${i.status === "open" && !taken.has(i.id) ? "" : "col-span-2"}`}>
              {t("fixed")}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

/** A photo from the camera, made smaller on the phone before it is kept. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

function RoomSheet(props: {
  task: FloorTask;
  day: FloorDay;
  t: T;
  language: FloorLanguage;
  userId: string;
  onClose: () => void;
  onStep: (step: "start" | "done" | "undo" | "declined" | "dnd") => void;
  onMinibar: (items: { serviceId: string; quantity: number }[]) => void;
  onProblem: (p: { pick: ProblemPick; urgency: Urgency; note: string; photo?: string }) => void;
  onLost: (p: { pick: LostPick; note: string; photo?: string }) => void;
}) {
  const { task, t } = props;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [form, setForm] = useState<null | "problem" | "lost">(null);
  const [photo, setPhoto] = useState<string | undefined>();
  const [noPhoto, setNoPhoto] = useState(false);
  const [pick, setPick] = useState<string>("");
  const [urgency, setUrgency] = useState<Urgency>("today");
  const [note, setNote] = useState("");
  const { Icon, tone } = KIND_STYLE[task.kind];
  const working = task.status === "open" || task.status === "in_progress";
  const skippable = task.kind === "stayover" || task.kind === "linen";
  const counted = Object.entries(counts).filter(([, n]) => n > 0);
  const big = "flex h-16 flex-col items-center justify-center gap-1 rounded-2xl font-medium";
  const small = "flex h-14 flex-col items-center justify-center gap-1 rounded-2xl bg-surface-2 text-sm";
  const reset = () => (setForm(null), setPhoto(undefined), setNoPhoto(false), setPick(""), setNote(""), setUrgency("today"));
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={props.onClose}>
      <div role="dialog" aria-label={task.roomNumber} onClick={(e) => e.stopPropagation()} className="mx-auto grid max-h-[90dvh] w-full max-w-md gap-3 overflow-y-auto rounded-t-3xl bg-canvas p-4 pb-8">
        <div className="mx-auto h-1 w-10 rounded-full bg-ink-10" />
        <div className="flex items-start gap-3">
          <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${tone}`}>
            <Icon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-3xl font-semibold">{task.roomNumber}</p>
            <p className="text-sm text-ink-60">
              {[t(`kind.${task.kind}`), t("minutes", { n: task.minutes }), task.guest?.surname, task.guest ? t("people", { n: task.guest.people }) : null, task.guest ? t("until", { date: task.guest.departure }) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button type="button" aria-label={t("close")} onClick={props.onClose} className="grid size-10 place-items-center rounded-full bg-surface shadow-card">
            <X className="size-5" />
          </button>
        </div>

        {task.notes.map((n, i) => {
          const { Icon, tone } = n.code ? NOTE_STYLE[n.code] : { Icon: StickyNote, tone: "text-ink-60" };
          return (
            <p key={i} className="flex items-center gap-2 rounded-2xl bg-surface p-3 text-sm">
              <Icon className={`size-5 shrink-0 ${tone}`} />
              {n.code ? t(`hknote.${n.code}`) : n.text}
            </p>
          );
        })}

        <div className="grid grid-cols-2 gap-2">
          {working ? (
            <>
              <button type="button" disabled={task.status !== "open"} onClick={() => props.onStep("start")} className={`${big} bg-accent text-white disabled:opacity-40`}>
                {t("start")}
              </button>
              <button type="button" onClick={() => props.onStep("done")} className={`${big} bg-[#1fa971] text-white`}>
                {t("done")}
              </button>
              {skippable ? (
                <>
                  <button type="button" onClick={() => props.onStep("declined")} className={small}>
                    {t("declined")}
                  </button>
                  <button type="button" onClick={() => props.onStep("dnd")} className={small}>
                    {t("dnd")}
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <>
              <p className={`${big} bg-surface`}>{t(task.status === "skipped" ? "status.skipped" : "status.done")}</p>
              {task.doneBy === props.userId ? (
                <button type="button" onClick={() => props.onStep("undo")} className={`${big} bg-surface-2`}>
                  {t("undo")}
                </button>
              ) : null}
            </>
          )}
        </div>

        {props.day.minibar.length ? (
          <section aria-label={t("minibar")} className="grid gap-2">
            <h3 className="text-sm text-ink-60">{t("minibar")}</h3>
            <div className="grid grid-cols-2 gap-2">
              {props.day.minibar.map((item) => (
                <div key={item.id} className="flex items-center gap-1 rounded-2xl bg-surface p-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{item.names[props.language] || item.name}</span>
                  <button type="button" aria-label={`− ${item.name}`} onClick={() => setCounts((c) => ({ ...c, [item.id]: Math.max(0, (c[item.id] ?? 0) - 1) }))} className="grid size-8 place-items-center rounded-full bg-surface-2">
                    <Minus className="size-4" />
                  </button>
                  <span className="w-5 text-center" data-count={item.name}>
                    {counts[item.id] ?? 0}
                  </span>
                  <button type="button" aria-label={`+ ${item.name}`} onClick={() => setCounts((c) => ({ ...c, [item.id]: (c[item.id] ?? 0) + 1 }))} className="grid size-8 place-items-center rounded-full bg-surface-2">
                    <Plus className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            {counted.length ? (
              <button type="button" onClick={() => (props.onMinibar(counted.map(([serviceId, quantity]) => ({ serviceId, quantity }))), setCounts({}))} className="h-12 rounded-full bg-accent font-medium text-white">
                {t("minibar.save")}
              </button>
            ) : null}
          </section>
        ) : null}

        {form ? (
          <section aria-label={t(form)} className="grid gap-3 rounded-2xl bg-surface p-3">
            <h3 className="font-medium">{t(form)}</h3>
            <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-surface-2">
              <Camera className="size-5" /> {t("photo")}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && void shrink(e.target.files[0]).then(setPhoto)} />
            </label>
            {photo ? <img src={photo} alt="" className="max-h-40 rounded-xl object-cover" /> : null}
            {/* photo first; only then the quick picks (or on purpose without one) */}
            {!photo && !noPhoto ? (
              <button type="button" onClick={() => setNoPhoto(true)} className="flex items-center justify-center gap-2 text-sm text-ink-60">
                <CameraOff className="size-4" /> {t("noPhoto")}
              </button>
            ) : null}
            {photo || noPhoto ? (
            <>
            <div className="flex flex-wrap gap-2">
              {(form === "problem" ? PROBLEM_PICKS : LOST_PICKS).map((p) => (
                <button key={p} type="button" aria-pressed={pick === p} onClick={() => setPick(p)} className={`rounded-full px-3 py-2 text-sm ${pick === p ? "bg-accent text-white" : "bg-surface-2"}`}>
                  {t(`${form === "problem" ? "pick" : "lost"}.${p}` as FloorKey)}
                </button>
              ))}
            </div>
            {form === "problem" ? (
              <div className="flex gap-2">
                {URGENCIES.map((u) => (
                  <button key={u} type="button" aria-pressed={urgency === u} onClick={() => setUrgency(u)} className={`flex-1 rounded-full px-3 py-2 text-sm ${urgency === u ? "bg-ink text-canvas" : "bg-surface-2"}`}>
                    {t(`urgency.${u}`)}
                  </button>
                ))}
              </div>
            ) : null}
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("note")} className="h-11 rounded-xl border border-ink-10 bg-surface-2 px-3" />
            </>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={reset} className="h-12 rounded-full bg-surface-2">
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={!pick}
                onClick={() => {
                  if (form === "problem") props.onProblem({ pick: pick as ProblemPick, urgency, note, ...(photo ? { photo } : {}) });
                  else props.onLost({ pick: pick as LostPick, note, ...(photo ? { photo } : {}) });
                  reset();
                }}
                className="h-12 rounded-full bg-accent font-medium text-white disabled:opacity-40"
              >
                {t("save")}
              </button>
            </div>
          </section>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setForm("problem")} className={small}>
              <Wrench className="size-5" /> {t("problem")}
            </button>
            <button type="button" onClick={() => setForm("lost")} className={small}>
              <PackageSearch className="size-5" /> {t("lost")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
