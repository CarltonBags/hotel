/**
 * Calendar Rooms view rules ("Calendar screen prototype"): what a drop of a
 * reservation bar means, and how unassigned bars share lanes.
 */
import { addDays } from "./rates-grid";
import type { AssignmentSegment } from "./reservation-edit";
import type { ReservationStatus } from "./reservations";
import { nightsOf } from "./stay-quote";

/** Visible days the Rooms view offers. */
export const CALENDAR_RANGES = [7, 14, 30] as const;
export type CalendarRange = (typeof CALENDAR_RANGES)[number];

export interface CalendarBar {
  reservationId: string;
  status: ReservationStatus;
  roomTypeId: string;
  arrival: string;
  departure: string;
  /** The Room Assignment segment the bar draws, or null in the unassigned lane. */
  segment: AssignmentSegment | null;
}

export interface DropTarget {
  roomId: string;
  roomTypeId: string;
  /** Night the bar's first night lands on. */
  arrival: string;
}

export type DropRefusal = "room_taken" | "checked_out" | "checked_in_arrival" | "checked_in_type" | "cancelled" | "nothing_changes" | "segment_dates" | "segment_type";

export type DropOutcome =
  | { kind: "move_room"; roomId: string; from: string }
  | { kind: "assign"; roomId: string }
  | { kind: "confirm_change"; roomId: string; roomTypeId: string; arrival: string; departure: string }
  | { kind: "refuse"; reason: DropRefusal };

/**
 * `roomFree(roomId, from, to)` tells whether a room is free of other
 * reservations for nights [from, to). Same type and same nights: applied at
 * once (move or assign). Other nights or another type: a confirmation first.
 */
export function dropOutcome(bar: CalendarBar, target: DropTarget, roomFree: (roomId: string, from: string, to: string) => boolean): DropOutcome {
  if (bar.status === "checked_out") return { kind: "refuse", reason: "checked_out" };
  if (bar.status === "cancelled" || bar.status === "no_show") return { kind: "refuse", reason: "cancelled" };
  const nights = nightsOf(bar.arrival, bar.departure).length;
  const sameType = target.roomTypeId === bar.roomTypeId;

  if (bar.segment) {
    const segmentShift = target.arrival !== bar.segment.from;
    // a later part of a moved stay can only change room, its nights are fixed by the stay
    if (bar.segment.from !== bar.arrival && segmentShift) return { kind: "refuse", reason: "segment_dates" };
    // ...and its room type, which belongs to the whole stay
    if (bar.segment.from !== bar.arrival && !sameType) return { kind: "refuse", reason: "segment_type" };
    if (!segmentShift && sameType) {
      if (target.roomId === bar.segment.roomId) return { kind: "refuse", reason: "nothing_changes" };
      if (!roomFree(target.roomId, bar.segment.from, bar.segment.to)) return { kind: "refuse", reason: "room_taken" };
      return { kind: "move_room", roomId: target.roomId, from: bar.segment.from };
    }
  } else if (target.arrival === bar.arrival && sameType) {
    if (!roomFree(target.roomId, bar.arrival, bar.departure)) return { kind: "refuse", reason: "room_taken" };
    return { kind: "assign", roomId: target.roomId };
  }

  if (bar.status === "checked_in" && target.arrival !== bar.arrival) return { kind: "refuse", reason: "checked_in_arrival" };
  if (bar.status === "checked_in" && !sameType) return { kind: "refuse", reason: "checked_in_type" };
  const departure = addDays(target.arrival, nights);
  if (!roomFree(target.roomId, target.arrival, departure)) return { kind: "refuse", reason: "room_taken" };
  return { kind: "confirm_change", roomId: target.roomId, roomTypeId: target.roomTypeId, arrival: target.arrival, departure };
}

/** Pack bars into the fewest lanes, first fit by arrival; a departure day can take the next arrival. */
export function packLanes<T extends { arrival: string; departure: string }>(bars: T[]): T[][] {
  const lanes: T[][] = [];
  for (const b of [...bars].sort((x, y) => x.arrival.localeCompare(y.arrival) || x.departure.localeCompare(y.departure))) {
    const lane = lanes.find((l) => l[l.length - 1]!.departure <= b.arrival);
    if (lane) lane.push(b);
    else lanes.push([b]);
  }
  return lanes;
}
