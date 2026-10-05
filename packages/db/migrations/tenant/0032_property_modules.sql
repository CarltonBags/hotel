-- Modules per property (ticket 88): each switching on, with the day it ends once switched off (at a month's end), and its setup checklist.
create table property_modules (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  module text not null constraint property_modules_module_check check (module in ('channel', 'guest_portal', 'point_of_sale', 'groups', 'whatsapp')),
  on_since date not null,
  off_at date,
  constraint property_modules_order_check check (off_at is null or off_at >= on_since),
  switched_on_by text not null,
  switched_off_by text,
  -- setup steps done: step -> true
  checklist jsonb not null default '{}'
);
create unique index property_modules_running_key on property_modules(property_id, module) where off_at is null;
