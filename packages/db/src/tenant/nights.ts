import type { PoolClient } from "pg";
import { roundMoney, type NightFigures } from "@hoteloftware/domain";

// Night figures of a property (ticket 82): shared by the fixed reports and the Budget's spreading (ticket 83).

export const ACTIVE = "('confirmed', 'checked_in', 'checked_out')";
/** A Charge's amount without VAT. */
export const NET = "(c.amount / (1 + c.tax_rate / 100))";

/**
 * Revenue per reservation and night: posted Charges (Corrections count with
 * the component and origin they correct), and for stays not yet checked in the room
 * and Service components on the books, net at the Tax Code's rate that night.
 */
export const NIGHT_REVENUE = `
  select c.reservation_id, c.service_date as date,
    sum(case when c.category = 'accommodation' and coalesce(o.origin, c.origin) <> 'fee' and coalesce(o.component, c.component) = 'room' then ${NET} else 0 end) as room,
    sum(case when coalesce(o.origin, c.origin) = 'fee' then ${NET} else 0 end) as fees,
    sum(case when c.category <> 'city_tax' then ${NET} else 0 end) as total
  from charges c left join charges o on o.id = c.corrects
  where c.property_id = $1 and c.voided_at is null and c.service_date between $2 and $3 and c.reservation_id is not null
  group by 1, 2
  union all
  select n.reservation_id, n.date,
    sum(case when n.kind = 'room' then n.amount / (1 + coalesce(tr.rate, 0) / 100) else 0 end) as room,
    0 as fees,
    sum(n.amount / (1 + coalesce(tr.rate, 0) / 100)) as total
  from reservation_night_components n
  join reservations r on r.id = n.reservation_id and r.status = 'confirmed'
  join rate_plans rp on rp.id = r.rate_plan_id
  -- the room component is the Rate Plan's accommodation Service
  join services s on s.id = coalesce(n.service_id, rp.accommodation_service_id)
  left join lateral (select t.rate from tax_code_rates t where t.tax_code_id = s.tax_code_id and t.valid_from <= n.date order by t.valid_from desc limit 1) tr on true
  where r.property_id = $1 and n.date between $2 and $3
  group by 1, 2`;

/** Nights of one property, per date (and room type): Available Rooms, occupied rooms and revenue. */
export async function nightsOf(tx: PoolClient, propertyId: string, range: { from: string; to: string }, roomTypeId: string | null): Promise<(NightFigures & { roomTypeId: string; roomType: string })[]> {
  const { rows } = await tx.query<{ date: string; room_type_id: string; room_type: string; available: number; occupied: number; room: string | null; fees: string | null; total: string | null }>(
    `with d as (select generate_series($2::date, $3::date, interval '1 day')::date as date),
     rev as (${NIGHT_REVENUE}),
     rev_by as (select rev.date, r.room_type_id, sum(rev.room) as room, sum(rev.fees) as fees, sum(rev.total) as total from rev join reservations r on r.id = rev.reservation_id group by 1, 2)
     select to_char(d.date, 'YYYY-MM-DD') as date, rt.id as room_type_id, rt.name as room_type,
       (select count(*) from rooms x where x.room_type_id = rt.id
          and not exists (select 1 from room_blocks b where b.room_id = x.id and b.kind = 'out_of_order' and b.from_date <= d.date and b.to_date > d.date))::int as available,
       (select count(*) from reservation_nights rn join reservations r on r.id = rn.reservation_id
          where r.room_type_id = rt.id and rn.date = d.date and r.status in ${ACTIVE})::int as occupied,
       rb.room, rb.fees, rb.total
     from d cross join room_types rt
     left join rev_by rb on rb.date = d.date and rb.room_type_id = rt.id
     where rt.property_id = $1 and ($4::uuid is null or rt.id = $4)
     order by 1, rt.name`,
    [propertyId, range.from, range.to, roomTypeId],
  );
  return rows.map((r) => ({
    date: r.date,
    roomTypeId: r.room_type_id,
    roomType: r.room_type,
    available: r.available,
    occupied: r.occupied,
    netRoomRevenue: roundMoney(Number(r.room ?? 0)),
    fees: roundMoney(Number(r.fees ?? 0)),
    totalRevenue: roundMoney(Number(r.total ?? 0)),
  }));
}

/** Sum the room types of each date into one night. */
export function perDate(nights: NightFigures[]): NightFigures[] {
  const m = new Map<string, NightFigures>();
  for (const n of nights) {
    const x = m.get(n.date) ?? { date: n.date, available: 0, occupied: 0, netRoomRevenue: 0, fees: 0, totalRevenue: 0 };
    m.set(n.date, { date: n.date, available: x.available + n.available, occupied: x.occupied + n.occupied, netRoomRevenue: x.netRoomRevenue + n.netRoomRevenue, fees: x.fees + n.fees, totalRevenue: x.totalRevenue + n.totalRevenue });
  }
  return [...m.values()];
}

