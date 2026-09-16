# Invoicery Business

Nordic salary-invoicing (umbrella employment) platform for **Denmark and
Norway**. A consultant invoices through Invoicery Business; Invoicery Business
carries full employer responsibility — employs the consultant, invoices the
client company, runs payroll, pays employer contributions and withholds tax.

Two markets, two legal entities, two languages, two payroll models. Sweden was
dropped; no Swedish copy or SE rate should exist anywhere.

## Layout

| File | What it is |
|---|---|
| `ib-markets.js` | **Market registry.** Legal entity, currency, locale, statutory rates, and the per-market payroll models. Authoritative for all money. |
| `ib-i18n.js` | **Copy.** Danish and Norwegian bokmål, keyed. Authoritative for all user-visible text. |
| `ib-core.js` | Storage, seed, market-aware formatting, escaping, status/type constants. |
| `ib-xlsx.js` | Zero-dependency .xlsx and .csv reader. |
| `ib-import.js` | Payroll-basis import: column mapping, validation, commit, Jeeves export. |
| `ib-xlsx-write.js` | Zero-dependency .xlsx writer. |
| `ib-lists.js` | Employee and payout list generation: canonical schema + per-system profiles. |
| `invoicery-business.html` | Landing page + consultant portal + company portal |
| `invoicery-business-admin.html` | Back-office: approvals, payroll runs, invoicing, registers |
| `scripts/payroll-check.cjs` | Golden values, invariants, parity, i18n, homoglyphs. |
| `scripts/render-smoke.cjs` | Every view, every role, both markets. |
| `scripts/import-check.cjs` | Reader, mapping, validation, commit, Jeeves. |
| `scripts/lists-check.cjs` | Writer, schema, profiles, gaps, PII redaction. |
| `scripts/make-lists.cjs` | CLI that generates the lists. |
| `scripts/serve.cjs` | Zero-dependency local dev server. |
| `fixtures/` | Real .xlsx test files; regenerate with `make-fixtures.py`. |

No build step, no dependencies, no framework. The HTML files open directly
from disk — that's what makes sales demos trivial. Scripts load in order:
`ib-markets.js` → `ib-i18n.js` → `ib-core.js` → app.

## Running it

```bash
node scripts/serve.cjs          # http://localhost:8080
node scripts/serve.cjs 8081     # another port
```

Opening the files from disk works too, and is the fastest path for a quick
look. Prefer the server when you care about `localStorage` behaving exactly as
it will in production (some browsers treat `file://` as an opaque origin and
drop storage), or when demoing to someone else on the same Wi-Fi — the server
prints a LAN address for that.

Every text response carries an explicit `charset=utf-8`. Without it a browser
may sniff latin-1 and render `lønkørsel` as `lÃ¸nkÃ¸rsel`, which tends to
surface first in front of a Danish customer.

## Excel import

Both a client company and superadmin can upload a payroll basis. Company
scope imports for the logged-in company; admin scope requires a company column
and routes each row.

```
file → IBXlsx.readTable → IBImport.mapColumns → validate → preview → commit
```

`validate()` is pure and writes nothing. The preview shows a verdict per row
and error rows are skipped on commit, never coerced. Re-importing the same
file flags every row as a duplicate rather than doubling the data.

**The .xlsx reader has no dependencies.** An .xlsx is a ZIP of XML, and both
halves are native: `DecompressionStream('deflate-raw')` for inflate, and a
small hand-rolled scanner rather than `DOMParser` (which does not exist in
Node, so one code path serves the browser and the tests). It handles shared
and inline strings, numbers, booleans, dates including the Excel 1900
leap-year quirk, and both STORED and DEFLATED entries. It does not handle
encrypted workbooks or legacy `.xls` — those are reported as such.

Row line numbers come from the sheet's `r=` attribute, so an error on "line 7"
is line 7 when the user opens the file. Do not renumber after filtering blanks.

### Jeeves

`toJeeves()` builds a payroll batch from paid assignments; `toJeevesCSV()`
emits the semicolon-separated, BOM-prefixed variant Danish and Norwegian Excel
expects.

> **The Jeeves field mapping is unverified.** Wage-type codes (lönearter),
> cost centres and employee-number schemes in `JEEVES_CONFIG` are placeholders
> and the admin UI says so. `sendToJeeves()` is deliberately a stub: it
> assembles and checks the payload but refuses to send, because inventing an
> endpoint contract would be worse than not having one. Fill in
> `JEEVES_CONFIG` and flip `verified` once the integration spec exists.

## Employee and payout lists

Two list types onboard a person into a payroll/HR system: an **employee list**
registers the person, a **payout list** registers what to pay them.

```bash
node scripts/make-lists.cjs --list-profiles
node scripts/make-lists.cjs --profile ff-no --market NO --csv
node scripts/make-lists.cjs --profile payroll --level payroll --redact
```

Same arrangement as the Jeeves export: a **canonical schema** (23 employee
fields, 13 payout fields) plus per-system **profiles** that select, order and
rename columns. Adding a system is a `PROFILES` entry, not a rewrite.

| Profile | Shape |
|---|---|
| `general` | every canonical field |
| `ff-no` / `ff-dk` | the Frilans Finans templates, column for column |
| `payroll` | identity, employment and tax — what an HR import wants |

Column headers are canonical **English and deliberately not localised**: these
files are read by other systems, whose mapping breaks the moment a header
changes language. The UI around the generator is translated; the file is not.

Identity numbers, postal codes and bank accounts are written as **text**, never
numbers — Excel eats leading zeros and turns long digit strings into scientific
notation. The writer enforces this via the field's `type`.

`checkEmployee` reports what blocks a registration before the file is sent, at
two levels: `always` (cannot register at all) and `payroll` (cannot pay yet).
`make-lists.cjs` exits non-zero when anything is missing, so it can gate a
handover.

`includeSensitive: false` produces a redacted copy with identity numbers and
bank details removed, for review or circulation.

### Notes on the Frilans Finans templates

Two things worth deciding before those become the house standard:

- The employee template has **no employment or tax fields** — no start date,
  employment type, tax card or tax municipality. Every payroll system needs
  them, so they are in the canonical schema and simply not emitted by `ff-no`.
- The payout template collapses dates and hours into **one free-text column**,
  which cannot be validated, summed or reconciled. The canonical schema keeps
  `dateFrom` / `dateTo` / `hours` separate and composes that column on export.

### Known gap

The supplied templates are legacy `.xls` (OLE2/BIFF). `ib-xlsx.js` reads
`.xlsx` and `.csv` and rejects `.xls` with a specific message. Generating is
unaffected — we write `.xlsx`, which Excel opens — but a filled-in `.xls`
template cannot currently be imported. Re-saving as `.xlsx` works.

## Markets

| | Denmark | Norway |
|---|---|---|
| Entity | Invoicery Business A/S | Invoicery Business AS |
| Language | Danish (`da`, `da-DK`) | Bokmål (`nb`, `nb-NO`) |
| Currency | DKK, `33.000 kr.` | NOK, `49 800 kr` |
| Assignment | opgave, `OPG-2026-001` | oppdrag, `OPP-2026-001` |
| Company reg | CVR-nummer | Organisasjonsnummer |
| Person id | CPR-nummer | Fødselsnummer |
| Storage keys | `IB_DK_*` | `IB_NO_*` |

Switching market reloads the app and swaps language, currency, rates, legal
entity **and dataset**. The two markets are separate legal entities with
separate books, so they share no data. Switching also ends the session rather
than carrying a login across books.

> **Rates are unverified.** Every rate in `ib-markets.js` is marked
> `verified: false` and the admin UI shows a standing warning. They are
> plausible values used to build and test the structure — they have not been
> confirmed against Skattestyrelsen, Skatteetaten, ATP or your own payroll
> operation. Get your Danish and Norwegian payroll people to sign off, then
> flip the flag per market.

## Non-negotiables

**1. Never compute money outside `ib-markets.js`.**
No rate literal in a view. Call `IB.calcPayroll(amount, {hours})` or
`IB.calcPayrollBatch(list)` and read fields off the result. Denmark and Norway
use structurally different chains, so an inlined rate is wrong in at least one
market by construction. `scripts/payroll-check.cjs` enforces this.

**2. Never hardcode user-visible text.**
All copy goes through `t('key')` (templates) or `data-i18n="key"` (static
markup). Every key must exist in **both** languages — a missing key renders as
`⟦key⟧` rather than silently falling back, and the smoke test fails on it.

**3. Never interpolate user data into HTML without `IB.esc()`.**
Every view builds markup with template strings and assigns via `innerHTML`.
Anything a user typed or that came out of storage — `description`, names,
emails, `period`, `adminNote` — goes through `esc()`, including inside
`onclick="fn('${...}')"` and `data-*` attributes.

**4. The schema is English; the UI is Danish and Norwegian.**
Field names are `consultantName`, `companyId`, `hourlyRate`, `amount`,
`createdDate`. Status values are `draft` / `pending` / `approved` / `paid` /
`rejected`. A two-market data model must not be written in one market's
language, and persisted values must not carry locale-specific diacritics.

**5. Identifiers are ASCII.**
Nordic æ/ø/å/ä/ö are fine in strings, comments and UI copy. Cyrillic and Greek
lookalikes are not — `sparaKonsult` was silently written with Cyrillic а/р/а
and only worked because definition and call site were pasted together.

**6. Round at display only.**
`fmt` / `fmtN` round for presentation. Calculations stay in full precision —
rounding mid-chain causes øre drift that compounds across a payroll run.

## The payroll models

Both start the same way:

```
invoiceAmount   = hours × hourlyRate        (excl. VAT)
vat             = invoiceAmount × 0,25
invoiceTotal    = invoiceAmount + vat       ← the client pays this
serviceFee      = invoiceAmount × 0,06
salaryBase      = invoiceAmount − serviceFee ← the employer's pot
```

### Norway — `model: 'no'`

Arbeidsgiveravgift is levied **on top of** gross salary *and* on the
feriepenger accrued on it, so gross is backed out of the pot by division:

```
salaryBase = gross × (1 + 0,102) × (1 + 0,141)
⇒ gross    = salaryBase / 1,257382

feriepenger        = gross × 0,102          accrued, paid the following year
arbeidsgiveravgift = (gross + feriepenger) × 0,141
forskuddstrekk     = gross × 0,32
net                = gross − forskuddstrekk
```

### Denmark — `model: 'dk'`

Structurally different. No large employer percentage; ATP is a fixed krone
amount, and **AM-bidrag is an employee deduction taken before A-skat**:

```
gross = (salaryBase − ATP_employer) / (1 + 0,125 + 0,015)

feriegodtgørelse = gross × 0,125
øvrige bidrag    = gross × 0,015
ATP_employee     fixed krone amount
AM-bidrag        = (gross − ATP_employee) × 0,08
A-skat           = (gross − ATP_employee − AM-bidrag) × 0,38
net              = gross − ATP_employee − AM-bidrag − A-skat
```

ATP pro-rates against a full-time month (160,33 h), so pass `{hours}`. An
assignment too small to carry the fixed ATP has it capped at the salary base
rather than going negative.

Both models must reconcile exactly on both sides:
`gross + employerCost === salaryBase` and `gross − employeeDeductions === net`.
The check script asserts this for every sample.

`calcPayroll` accepts a per-call override object — use it when per-consultant
rates arrive (Norwegian arbeidsgiveravgift is geographically zoned 0–14,1 %;
Danish A-skat comes from the individual's skattekort).

## Adding a market

1. Add an entry to `MARKETS` in `ib-markets.js` — entity, locale, currency,
   rates, and either an existing `model` or a new `calcXX` function.
2. Add its language to `STRINGS` in `ib-i18n.js`. All 391 keys, no exceptions.
3. Add seed data and an ID prefix in `ib-core.js`.
4. Add golden values for the new market to `scripts/payroll-check.cjs`,
   derived by hand and written out in the comment the way the existing two are.
5. Run both scripts.

## Before committing

```bash
node scripts/payroll-check.cjs   # golden values, invariants, parity, i18n, homoglyphs
node scripts/render-smoke.cjs    # every view × every role × both markets
node scripts/import-check.cjs    # reader, mapping, validation, commit, Jeeves
node scripts/lists-check.cjs     # writer, schema, profiles, gaps, PII
```

All four must exit 0.

`render-smoke.cjs` exists because `node --check` cannot catch a view that
references a variable which no longer exists, or a translation key that was
never defined — the syntax is valid, the reference is dead, and it only fails
when a user clicks that nav item.

A PostToolUse hook (`.claude/hooks/guard-edit.cjs`) also runs on every edit and
reports homoglyphs, inline rate literals, unescaped interpolations and
leftover Swedish. It is advisory — it never blocks an edit.

## Known gaps

- Passwords are plaintext in seed data. Demo credentials only — never ship.
- No server, no auth, no authorization. Role isolation is client-side
  filtering, which is presentation, not security.
- `localStorage` is prototype storage: not multi-tenant, no audit trail, holds
  payroll data for named individuals in a browser. Replacing it is the main
  task standing between this and a sellable product.
- `confirm()` is still used on the payroll-run path. Native dialogs block
  browser-automation tooling; prefer an in-page modal when touching it.
- No audit trail beyond the free-text `adminNote` string.
- `statusBadge` is intentionally duplicated between the two apps — they render
  different badge markup. Do not unify it.
- Landing-page markup carries Danish as its inline fallback text, replaced at
  runtime by `applyI18n()`. A Norwegian visitor sees Danish for one frame.
