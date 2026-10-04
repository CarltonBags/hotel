import type { DowntimeGuestRow, EmergencyReport, RoomRackRow } from "@hoteloftware/db";
import type { DowntimeList } from "@hoteloftware/domain";

export type DowntimeText = Record<
  | "downtime.arrivals"
  | "downtime.departures"
  | "downtime.inHouse"
  | "downtime.roomRack"
  | "downtime.form"
  | "downtime.room"
  | "downtime.guest"
  | "downtime.persons"
  | "downtime.stay"
  | "downtime.balance"
  | "downtime.notes"
  | "downtime.type"
  | "downtime.state"
  | "downtime.next"
  | "downtime.floor"
  | "downtime.vacant"
  | "downtime.contacts"
  | "downtime.cardHolds"
  | "downtime.formFields",
  string
>;

/**
 * The Downtime Reports as plain tables (ticket 86): printed from the menu,
 * and shown read-only on the desk while the connection is down. No server
 * code: the offline view renders it in the browser from the kept copy.
 */
export function DowntimeLists({ set, lists, m, emergency }: { set: Omit<EmergencyReport, "contacts" | "cardHolds"> & Partial<Pick<EmergencyReport, "contacts" | "cardHolds">>; lists: DowntimeList[]; m: DowntimeText; emergency?: boolean }) {
  const show = set.options.show;
  const section = "break-after-page print:break-after-page mb-6";
  const th = "border-b border-ink-10 p-1 text-left text-xs font-medium text-ink-60";
  const td = "border-b border-ink-10 p-1 align-top";
  const guests = (title: string, rows: DowntimeGuestRow[], key: DowntimeList) => (
    <section key={key} className={section} data-downtime-list={key}>
      <h2 className="mb-2 text-base font-medium">
        {title} · {set.property.name} · {set.businessDate} ({rows.length})
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={th}>{m["downtime.room"]}</th>
            <th className={th}>{m["downtime.guest"]}</th>
            <th className={th}>{m["downtime.persons"]}</th>
            <th className={th}>{m["downtime.stay"]}</th>
            <th className={th}>{m["downtime.type"]}</th>
            {show.balance ? <th className={`${th} text-right`}>{m["downtime.balance"]}</th> : null}
            {show.notes || show.hkNotes ? <th className={th}>{m["downtime.notes"]}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reservationId}>
              <td className={td}>{r.room ?? "–"}</td>
              <td className={td}>
                {r.guestLastName}, {r.guestFirstName} {r.vip ? "· VIP" : ""}
                <div className="text-xs text-ink-60">{r.confirmationNumber}</div>
              </td>
              <td className={td}>{r.adults + r.children}</td>
              <td className={td}>
                {r.arrival} – {r.departure}
              </td>
              <td className={td}>
                {r.roomTypeCode} · {r.ratePlanName}
              </td>
              {show.balance ? <td className={`${td} text-right tabular-nums`}>{r.balance.toFixed(2)}</td> : null}
              {show.notes || show.hkNotes ? (
                <td className={td}>
                  {show.notes ? r.notes : ""}
                  {show.hkNotes && r.hkNotes.length ? <div className="text-xs">{r.hkNotes.join(", ")}</div> : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
  const rack = (rows: RoomRackRow[]) => {
    const floors = [...new Set(rows.map((r) => r.floor))];
    return (
      <section key="room_rack" className={section} data-downtime-list="room_rack">
        <h2 className="mb-2 text-base font-medium">
          {m["downtime.roomRack"]} · {set.property.name} · {set.businessDate}
        </h2>
        {floors.map((f) => (
          <table key={f} className="mb-3 w-full text-sm">
            <thead>
              <tr>
                <th className={th} colSpan={6}>
                  {m["downtime.floor"]} {f || "–"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.floor === f)
                .map((r) => (
                  <tr key={r.roomId} data-rack-room={r.room}>
                    <td className={`${td} w-16 font-medium`}>{r.room}</td>
                    <td className={td}>{r.roomType}</td>
                    <td className={td}>
                      {r.cleanliness}
                      {r.block ? ` · ${r.block}` : ""}
                    </td>
                    <td className={td}>{r.guest ? `${r.guest.name} (${r.guest.persons}) → ${r.guest.departure}` : m["downtime.vacant"]}</td>
                    <td className={td}>{r.next ? `${m["downtime.next"]}: ${r.next.name} ${r.next.arrival}` : ""}</td>
                    <td className={`${td} w-24`} />
                  </tr>
                ))}
            </tbody>
          </table>
        ))}
      </section>
    );
  };
  const forms = Array.from({ length: set.options.blankForms }, (_, i) => (
    <section key={`form-${i}`} className={section} data-downtime-list="registration_forms">
      <h2 className="mb-4 text-base font-medium">
        {m["downtime.form"]} · {set.property.name}
      </h2>
      {m["downtime.formFields"].split("|").map((label) => (
        <div key={label} className="mb-5 border-b border-ink-40 pb-1 text-xs text-ink-60">
          {label}
        </div>
      ))}
    </section>
  ));
  return (
    <div className="text-ink">
      {lists.includes("arrivals") ? guests(m["downtime.arrivals"], set.arrivals, "arrivals") : null}
      {lists.includes("departures") ? guests(m["downtime.departures"], set.departures, "departures") : null}
      {lists.includes("in_house") ? guests(m["downtime.inHouse"], set.inHouse, "in_house") : null}
      {lists.includes("room_rack") ? rack(set.roomRack) : null}
      {emergency && set.contacts ? (
        <section className={section} data-downtime-list="contacts">
          <h2 className="mb-2 text-base font-medium">{m["downtime.contacts"]}</h2>
          <ul className="text-sm">
            {set.contacts.map((c) => (
              <li key={`${c.name}-${c.room}`}>
                {c.room ?? "–"} · {c.name} · {c.phone || "–"} · {c.email || "–"}
              </li>
            ))}
          </ul>
          <h2 className="mb-2 mt-4 text-base font-medium">{m["downtime.cardHolds"]}</h2>
          <ul className="text-sm">
            {(set.cardHolds ?? []).map((h) => (
              <li key={`${h.name}-${h.room}`}>
                {h.room ?? "–"} · {h.name} · {h.amount.toFixed(2)} {h.currency}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {lists.includes("registration_forms") ? forms : null}
    </div>
  );
}
