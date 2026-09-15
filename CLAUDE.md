# Invoicery Business

Nordic salary-invoicing (umbrella employment) platform. A consultant invoices
through Invoicery Business; Invoicery Business carries full employer
responsibility — employs the consultant, invoices the client company, runs
payroll, pays employer contributions and withholds tax.

## Layout

| File | What it is |
|---|---|
| `ib-core.js` | **Shared domain core.** Storage, seed, statutory rates, all payroll math, formatting, HTML escaping. Authoritative. |
| `invoicery-business.html` | Marketing landing page + konsult portal + företag portal |
| `invoicery-business-admin.html` | Internal back-office: approvals, lönekörning, invoicing, registers |
| `scripts/payroll-check.cjs` | Correctness + parity guard. |
| `scripts/render-smoke.cjs` | Executes all 24 view functions + XSS containment. |

No build step, no dependencies, no framework. The HTML files open directly
from disk. Keep it that way unless deliberately migrating — it's what makes
sales demos trivial.

## Non-negotiables

**1. Never compute money outside `ib-core.js`.**
No rate literal (`0.06`, `0.3142`, `0.32`, `0.25`, `1.25`) may appear in a
view. Call `IB.calcPayroll(belopp)` or `IB.calcPayrollBatch(list)` and read
fields off the result. This rule exists because it was already violated: the
consultant payslip and the admin payroll run drifted 8 676 kr apart on a
single uppdrag before anyone noticed. `scripts/payroll-check.cjs` enforces it.

**2. Never interpolate user data into HTML without `IB.esc()`.**
Every view builds markup with template strings and assigns via `innerHTML`.
Anything a user typed or that came out of storage — `beskrivning`, names,
emails, `period`, `adminNote` — goes through `esc()`. This includes values
inside `onclick="fn('${...}')"` attributes.

**3. Identifiers are ASCII.**
Swedish å/ä/ö are fine in strings, comments and UI copy. They are also fine
in identifiers (`köraEnLon` is existing and valid). What is forbidden is
Cyrillic or Greek lookalikes — `sparaKonsult` was silently written with
Cyrillic а/р/а and only worked because definition and call site were
copy-pasted together. The check script scans for these.

**4. Round at display only.**
`fmt` / `fmtN` round for presentation. Calculations stay in full precision —
rounding mid-chain causes öre drift that compounds across a lönekörning.

## The payroll model

```
fakturabelopp     = timmar × timlön                 (excl. moms)
moms              = fakturabelopp × 0,25
fakturatotal      = fakturabelopp + moms            ← what the client pays

serviceavgift     = fakturabelopp × 0,06
lönebas           = fakturabelopp − serviceavgift   ← the employer's pot

bruttolön         = lönebas / 1,3142                ← back it OUT of the pot
arbetsgivaravgift = lönebas − bruttolön

preliminärskatt   = bruttolön × 0,32
nettolön          = bruttolön − preliminärskatt     ← what the consultant gets
```

Arbetsgivaravgift is levied **on top of** gross salary, so gross is obtained
by dividing the pot by `1 + rate`. `lönebas × (1 − 0,3142)` is wrong and
understates the consultant's salary.

Rates are simplified and will need per-consultant resolution before
production: arbetsgivaravgift has reduced brackets for employees born 2003+
and for those 66+, and preliminärskatt comes from the individual's
skattetabell, not a flat 32%. `IB.calcPayroll` accepts a per-call override
object for exactly this.

## Domain vocabulary

Swedish throughout — UI copy, data fields, and most identifiers.

| Term | Meaning |
|---|---|
| uppdrag | assignment / engagement (the core record) |
| konsult | the consultant, employed by Invoicery Business |
| företag | the client company that receives the work |
| lönekörning | payroll run |
| lönespecifikation | payslip |
| arbetsgivarintyg | employment certificate (for loans, housing, a-kassa) |
| arbetsgivaravgift | employer social contributions |
| preliminärskatt | withheld income tax |
| orgnr | company registration number |
| personnummer | Swedish personal identity number |

## Status values

Persisted in localStorage and compared by equality — diacritics are part of
the value. Use `IB.STATUS` rather than retyping them.

`utkast` · `väntar_godkännande` · `godkänt` · `utbetalt` · `avvisat`

## Data layer

`localStorage`, keyed `IB_USERS`, `IB_UPPDRAG`, `IB_FORETAG`, `IB_SESSION`,
`IB_SEEDED`. Access it through `IB.getUsers()` / `IB.getUppdrag()` etc., never
`localStorage` directly — the seed guard is versioned (`IB.SEED_VERSION`) and
bypassing it reintroduces the split-seed bug where the two apps wrote
conflicting user records behind the same guard key.

This is prototype storage. It is not multi-tenant, has no audit trail, and
holds payroll data for named individuals in a browser. Replacing it is the
main task standing between this and a sellable product.

## Known gaps

- Passwords are plaintext in seed data. Demo credentials only — never ship.
- No server, no auth, no authorization. Role isolation is client-side
  filtering (`filter(u => u.konsultId === ME.id)`), which is presentation,
  not security.
- `alert()` / `confirm()` are used for flow control. Native dialogs block
  browser-automation tooling; prefer in-page modals when touching those paths.
- No audit trail beyond the free-text `adminNote` string.
- `statusBadge` is intentionally duplicated — the two apps render different
  badge markup. Do not "fix" this by unifying it.

## Before committing

```bash
node scripts/payroll-check.cjs   # rates, invariants, parity, homoglyphs
node scripts/render-smoke.cjs    # every view renders; hostile input stays escaped
```

Both must exit 0.

`render-smoke.cjs` exists because `node --check` cannot catch a view that
references a variable which no longer exists — the syntax is valid, the
reference is dead, and it only fails when a user clicks that nav item. It
loads each app's inline script into a sandboxed DOM shim and calls every
render function for every role.

A PostToolUse hook (`.claude/hooks/guard-edit.cjs`) also runs on every edit
and reports homoglyphs, inline rate literals and unescaped interpolations.
It is advisory — it never blocks an edit.
