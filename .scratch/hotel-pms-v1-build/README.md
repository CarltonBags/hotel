# Hotel PMS v1 — build tickets

Source spec: the wayfinder map `.scratch/hotel-pms-v1/map.md`, `CONTEXT.md`, `docs/adr/`, `docs/research/`, `docs/design/`.

- `issues/01`–`09` are **gates**: open owner tasks carried over from the map (status `ready-for-human`). Each blocks only the build tickets that depend on it. The wayfinder ticket it points to stays open until the gate is done.
- `issues/10`–`95` are build tickets (status `ready-for-agent`), numbered in dependency order. Work the frontier: any ticket whose blockers are all done.
- Gate 07 (lock vendors) is one ticket with a per-vendor table; a plugin ticket (70–81) may start once its own vendor line reads "obtained".
- Accounting export (56) waits for gate 04 by the owner's choice of 2026-09-28.
