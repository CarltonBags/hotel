# Installing the Site Bridge

The Site Bridge is a small program on the PC that already runs the hotel's lock software (ADR 0014). It connects lock systems on the hotel's network to Hoteloftware, and FIAS-based tills too. It only ever calls out to our service over HTTPS. No port is opened to the internet, and it works behind the hotel's router (NAT) without any change there. The one exception is a FIAS till: its plugin listens on the hotel's own network, and only for the till's address.

## What our staff do at go-live

1. **Enroll the Bridge.** In Hoteloftware, under Settings → Site Bridge, enroll a Bridge and name it after the PC it runs on. Copy the token: it is shown once.
2. **Install Node.js 20 or later** on the lock PC (Windows 10/11 or Windows Server 2016 or later).
3. **Copy the program.** Copy the Bridge program folder (`apps/bridge` with its dependencies, or the packaged build) to `C:\Hoteloftware\Bridge`.
4. **Configure it.** Write `bridge.json` beside the program:

   ```json
   {
     "server": "https://worker.<our domain>",
     "token": "hsb_…",
     "pluginsDir": "plugins",
     "plugins": {
       "<lock plugin name>": { "server": "http://127.0.0.1:<lock server port>" }
     }
   }
   ```

   The plugin settings (the lock server's address, its user and so on) stay on this PC. They never reach our service.
5. **Run it as a Windows service** that starts with the PC. For example with NSSM: `nssm install HoteloftwareBridge "C:\Program Files\nodejs\node.exe" "--import tsx src\main.ts"` (tsx comes with the program's dependencies: run `pnpm install --prod` in its folder first), with the working directory `C:\Hoteloftware\Bridge`.
6. **Check it is connected.** Within a minute, Settings → Site Bridge shows it as connected, with its version.
7. **Send the lock system's plugin.** On the same page, send the plugin version for the hotel's lock system. The Bridge installs it on its next call, and the page shows the plugin and its health.
8. **Choose the lock system.** Under Settings → Door locks, choose "On the hotel's network (Site Bridge)", the plugin's name, and each room's door.
9. **Tick the go-live item.** The go-live checklist item "Site Bridge connected" is now done.

## A FIAS till (Simphony, Vectron and others)

A till that expects a local interface server connects to the Bridge's FIAS plugin on the hotel's network. A hotel without an on-site lock system gets the Bridge for its till alone.

1. **Connect the till.** Under Settings → External tills, connect a "FIAS till through the Site Bridge". Copy its key, and set the Tax Code of each rate where a rate fits more than one code.
2. **Send the plugin.** Under Settings → Site Bridge, send `fias-till` to the Bridge.
3. **Configure the plugin.** In the Bridge's `bridge.json`, add:

   ```json
   "fias-till": { "port": "5010", "allowFrom": "192.168.1.20", "api": "https://<hotel>.<our domain>/api/till/v1", "key": "hs_till_…", "subtotalRates": "1:19,2:7" }
   ```

   - `port` is where the till connects, on the lock PC's address.
   - `allowFrom` is the till's address, or a comma-separated list of addresses. No other device may connect.
   - `subtotalRates` gives the tax rate of each FIAS subtotal, as the till is set up. The subtotals are tax-inclusive, and their discounts are added in.
4. **Set up the till.** Point the till's PMS interface at that PC and port.

What the till does, and what we do with it:

- **Inquiry** (a PR record with PI): only checked-in guests the till may charge are answered (PL record).
- **Posting** (PS, or PR with TA): goes to the room as totals per Tax Code, with the tip on its own line. The check number names the bill.
- **Negative posting:** a check posted negative for its whole amount is taken back as a Correction of the earlier posting. A partial negative posting is refused; the desk corrects it instead.
- **Refused postings:** a posting is refused unless an inquiry offered that guest first. It is also refused if its total does not add up (subtotals with their discounts, service charge and tip), and if it carries tax fields; postings must be tax-inclusive.

**Not yet checked against the real thing.** The plugin follows the research's reading of FIAS 2.20: records, link start, inquiry and posting fields. It is tested with our own simulated till only. Before the first hotel, check it against the FIAS specification text and a Simphony or Vectron test till.

Settings → Site Bridge shows the plugin's health: whether a till is connected, its last message, and whether our interface is reachable.

## Updates and monitoring

- **Plugin updates** are sent from Settings → Site Bridge. The Bridge fetches the version, checks its SHA-256 and activates it without a reinstall. Every version we publish is kept, so going back means sending an older version.
- **Losing the Bridge:** if it does not call for three minutes, the property's Property Managers are notified. They are notified again when it is back.
- **Revoking:** a revoked Bridge's token stops working at once. Enroll a new one with a new token.

## Not yet done

- A signed Windows installer and service wrapper.
- A test on a Windows machine behind NAT (ticket 68's first acceptance check).
