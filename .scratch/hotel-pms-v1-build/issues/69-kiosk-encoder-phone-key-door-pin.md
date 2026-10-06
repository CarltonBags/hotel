# 69 — Kiosk key-card encoder, phone key in the Portal and door PIN

**What to build:** Where the property's plugin supports it: the Self Check-in kiosk encodes a key card through the network encoder assigned to that kiosk Device; the Guest Portal shows a Digital Key on the guest's phone from Checked-in until revoke; a door PIN is shown to the guest. The final kiosk screen follows the key handover setting.

**Blocked by:** 67 Lock interface, key issue and revoke, first cloud plugin, 49 Self Check-in on kiosk and phone, 40 Guest Portal with Portal Link and Pre-check-in

**Status:** in review (PR stacked on ticket 66)

- [x] Kiosk flow ends with an encoded card on a test encoder
- [x] Phone key appears in the Portal only after Checked-in and vanishes at check-out
- [x] Door PIN shown and revoked with the reservation

## Comments

**Built:** where the property's lock system supports the handover: the Self Check-in kiosk writes the key card on the encoder set for that kiosk Device (only right after the stay's Self Check-in finished on that kiosk; one card for a double tap within a minute); the last screen follows the handover (reception; card ready; door PIN — on the phone shown, on the lobby kiosk pointed to the Guest Portal; Digital Key — a button on the phone, the Portal on the kiosk), asking for a PIN or Digital Key until the lock system has made it and else sending the guest to reception with the desk told why; the Guest Portal shows the door PIN or the Digital Key (what the guest's phone opens, sealed; renewed when the lock system renews it) from Checked-in until check-out. Changing the handover takes the other kind of key back (cards stay). The handover lives only with the lock settings (the placeholder column on properties is dropped); kiosk Devices get their encoder in the lock settings (only the property's own Devices).

**Verified:** domain (handover offered to guests, handover change); db `guest-keys.test.ts` (Digital Key after check-in, PIN after a handover change replacing it, kiosk card only after Self Check-in on that kiosk and once for two taps at once, keys gone at check-out); full db suite; walkthrough 7/7 through the real kiosk flow (card written on the kiosk's encoder; PIN pointed to the Portal, shown there; Digital Key in the Portal, gone at check-out).

**Review fixes:** no PIN on the lobby screen; kiosk card only after Self Check-in on that kiosk, serialised for simultaneous taps; the desk alerted when the key cannot be made; Portal key reads through the Portal Link's own check and never break the Portal; kiosk scope on key reads; one handover's keys at a time; Digital Key renewed on change; device check for encoders in the db layer; polling timer cleared.

**Open points:** Digital Keys and kiosk encoders are verified with the simulated lock system only; real phone keys depend on the first vendor plugin with that capability.
