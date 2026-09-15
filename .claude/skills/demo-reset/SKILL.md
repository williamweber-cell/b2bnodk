---
name: demo-reset
description: Print the snippet that resets Invoicery Business demo data to a known clean state, per market or for both, for sales demos and manual testing.
disable-model-invocation: true
---

# /demo-reset

Demo data lives in the browser's `localStorage`, scoped per market
(`IB_DK_*`, `IB_NO_*`), so it survives reloads and persists between the two
apps. A demo left half-approved stays half-approved — usually discovered
while someone is watching.

## Give the user this

Open either app, press **F12**, paste into the Console, press Enter:

```js
IB.resetDemo(); location.reload();          // both markets
IB.resetDemo('DK'); location.reload();      // Denmark only
IB.resetDemo('NO'); location.reload();      // Norway only
```

To switch market from the console:

```js
IB.setMarket('NO'); location.reload();
```

## What they get back, per market

| Role | Denmark | Norway |
|---|---|---|
| Admin | `admin@invoicerybusiness.dk` | `admin@invoicerybusiness.no` |
| Consultant | `sara@konsulent.dk` | `sara@konsulent.no` |
| Consultant | `erik@konsulent.dk` | `erik@konsulent.no` |
| Company | `info@virksomhed.dk` | `info@bedrift.no` |
| Company | `hr@prisjakt.dk` | `hr@prisjakt.no` |

Passwords: `admin123` / `klient123` / `kund123`.

Four assignments each: one `approved` (ready for a payroll run), two
`pending`, one `paid`. That mix is deliberate — every screen has something to
show. A demo starting from empty spends its first two minutes on data entry.

The login box builds these buttons from the seeded users at runtime, so they
always match the selected market.

## A good demo path

1. Log in as **Sara**, create an assignment against the company address
2. Log out, in as the **company**, approve it
3. Log out, in as **admin**, Payroll, run it
4. Back as **Sara**, Payslips, the full breakdown is there

Then flip the market switch and show the same flow in the other country —
different language, currency, legal entity and payroll model, same product.
That contrast is the strongest ninety seconds in the demo.

## Note

Plaintext demo passwords live in `ib-core.js`. Prototype only; never ship.
