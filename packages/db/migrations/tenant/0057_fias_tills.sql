-- FIAS-based tills (ticket 66): served by the Site Bridge's FIAS plugin, which posts through our room charge interface with this connection's key.
alter table till_connections drop constraint till_connections_kind_check;
alter table till_connections add constraint till_connections_kind_check check (kind in ('api', 'lightspeed', 'fias'));
