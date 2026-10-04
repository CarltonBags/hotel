import type { DowntimeText } from "@/components/downtime-lists";
import type { Messages } from "@/i18n/messages";

/** The texts the downtime lists need, picked from the user's messages (the offline view gets them with its copy). */
export function downtimeText(m: Messages): DowntimeText {
  const keys: (keyof DowntimeText)[] = [
    "downtime.arrivals", "downtime.departures", "downtime.inHouse", "downtime.roomRack", "downtime.form", "downtime.room", "downtime.guest", "downtime.persons",
    "downtime.stay", "downtime.balance", "downtime.notes", "downtime.type", "downtime.state", "downtime.next", "downtime.floor", "downtime.vacant",
    "downtime.contacts", "downtime.cardHolds", "downtime.formFields",
  ];
  return Object.fromEntries(keys.map((k) => [k, m[k]])) as DowntimeText;
}
