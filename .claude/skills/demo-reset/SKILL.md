---
name: demo-reset
description: Print the snippet that resets Invoicery Business demo data to a known clean state, for sales demos and manual testing.
disable-model-invocation: true
---

# /demo-reset

Demo data lives in the browser's `localStorage`, so it persists across
reloads and between the two apps. A demo left half-approved stays
half-approved until it is cleared — which is exactly when someone is
watching.

## Give the user this

Open either app, press **F12**, paste into the Console, press Enter:

```js
IB.resetDemo(); location.reload();
```

That removes every `IB_*` key and reseeds at the current `SEED_VERSION`.

## What they get back

| | |
|---|---|
| Admin | `admin@invoicerybusiness.se` / `admin123` — Anna Lindström |
| Konsult | `sara@konsult.se` / `klient123` — Sara Bergström |
| Konsult | `erik@konsult.se` / `klient123` — Erik Johansson |
| Företag | `info@foretag.se` / `kund123` — Lides Event AB |
| Företag | `hr@prisjakt.se` / `kund123` — Prisjakt Sverige AB |

Four uppdrag: one `godkänt` (ready for lönekörning), two
`väntar_godkännande`, one `utbetalt`.

That mix is deliberate — it gives every screen something to show. A demo
that starts from an empty state spends its first two minutes on data entry.

## A good demo path

1. Log in as **Sara** → Skapa uppdrag against `info@foretag.se`
2. Log out → in as **Lides Event** → Godkänn uppdrag → approve it
3. Log out → in as **admin** → Lönekörning → Kör lön
4. Back as **Sara** → Lönespecifikationer → the payslip is there

That covers the whole value chain in about ninety seconds.

## Note

These are demo credentials with plaintext passwords in `ib-core.js`. They
exist for the prototype only and must not survive into anything
internet-facing.
