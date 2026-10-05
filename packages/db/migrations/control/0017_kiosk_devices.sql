-- A guest Device is a registration tablet the desk sends to, or a lobby kiosk for Self Check-in (ticket 49).
alter table control.devices add column guest_mode text not null default 'tablet' constraint devices_guest_mode_check check (guest_mode in ('tablet', 'kiosk'));
alter table control.device_enrolments add column guest_mode text not null default 'tablet' constraint device_enrolments_guest_mode_check check (guest_mode in ('tablet', 'kiosk'));
