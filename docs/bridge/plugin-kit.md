# Plugin kit: adding a lock vendor

A vendor's lock system on the hotel's network is reached through a **Lock Plugin** on the Site Bridge. Adding one does not touch the product: the plugin implements the one lock interface, passes the harness, and is published and sent to the hotels that need it.

## The template

`packages/bridge-kit/template/simulated-onprem.mjs` is a complete plugin for the simulated on-premises lock system. Copy it and rename it (`name`, version `1.0.0`). Then replace the calls to the simulated lock server with the vendor's own interface:

- `capabilities`: what the vendor can do:
  - `card`: key cards written on encoders;
  - `pin`: door PINs;
  - `phoneKey`: Digital Keys;
  - `remoteRevoke`: online locks that take a key back at the door;
  - `readCard`;
  - `encoders`.

  The desk offers only these.
- `create(config)` gets the settings the hotel's `bridge.json` keeps for the plugin, and returns the plugin with these methods:
  - `issueKey`, `updateKey`, `revokeKey`, `revokeByKeyId`;
  - `readCard`, `listEncoders`, `health`.
- Errors:
  - A plugin throws an error named `LockRefused` when the lock system refuses something; retrying does not help.
  - It throws any other error when the system is away; we try again later.

## The harness

```
pnpm --filter @hoteloftware/bridge-kit harness path/to/plugin.mjs                 # against the simulated on-premises lock system
pnpm --filter @hoteloftware/bridge-kit harness path/to/plugin.mjs http://lock-srv  # against a vendor's test system
```

It takes the plugin through what the product asks of it:

1. Describes itself.
2. Health.
3. Lists encoders.
4. Issues a key.
5. Reads the card back.
6. Changes validity.
7. Revokes.

Each step passes or fails with its reason.

## Certification checklist

Before a plugin is published for hotels:

- [ ] The harness passes against the simulated system, and against the vendor's test or demo system.
- [ ] The capabilities match what the vendor's system really does. An offline card system declares `remoteRevoke: false`.
- [ ] A key's validity ends at the time given (check-out plus grace), in the lock system's own time zone.
- [ ] Revoking a key the lock system no longer has counts as revoked, not as an error.
- [ ] `revokeByKeyId` finds a key by the name we gave it (`hs-<our key id>`) where the vendor allows names. Otherwise it is documented as not possible.
- [ ] The plugin never logs or returns card data or PINs beyond what the method returns.
- [ ] The plugin keeps no state outside its instance. A restart of the Bridge loses nothing.
- [ ] Timeouts: every call to the vendor's system ends within 15 seconds.
- [ ] The vendor's partner agreement allows the integration (ticket "Lock vendor partner agreements").
- [ ] The plugin is published with `pnpm --filter @hoteloftware/db publish-bridge-plugin <file>`. Each fix is a new version.
