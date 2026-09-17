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
| `ib-design.css` | **Design system.** Colour, type, spacing, elevation, grid. Authoritative for all styling. |
| `ib-markets.js` | **Market registry.** Legal entity, currency, locale, statutory rates, and the per-market payroll models. Authoritative for all money. |
| `ib-i18n.js` | **Copy.** English, Danish and Norwegian bokmål, keyed. Authoritative for all user-visible text. |
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

## Order approval

A company opens an assignment from the approval list, reads it in full, and
acts on it: `b-approve` (list) → `b-order` (detail) → approve / reject /
request change.

**The detail view shows what the company pays, not what the consultant
earns.** Hours × rate, VAT, total. `calcPayroll` also returns gross, net,
withholding and holiday pay, so it is one careless line away from putting a
consultant's salary on a client's screen. `scripts/render-smoke.cjs` asserts
none of those figures appear in `bOrder()` output.

**Rejecting or asking for a change requires a reason.** Both used to flip the
status and discard why, so the consultant saw "rejected" with no explanation
and no way to act on it. The note is now recorded and surfaced under the
assignment in the consultant's own list.

**Every transition is recorded** in `assignment.history` — `{at, by, action,
note}`. The only trail before this was a free-text `adminNote`, so an
approval could not be attributed or dated. Seeded assignments carry their
creation event, so the history panel reads correctly from a fresh demo.

Access control: `currentOrder()` looks up through `ours()`, which filters on
`companyId === ME.id`, and `orderApprove` / `orderCommit` re-check ownership
before writing. A company cannot open or act on another company's order by
guessing an id. This is still client-side and therefore presentation, not
security — see Known gaps.

## Design system

`ib-design.css` is transcribed from `design_system_zip/` and is the single
source of truth for colour, type, spacing, elevation and the grid. Both apps
link it before their inline `<style>`.

| | |
|---|---|
| Typeface | **Asap** — 400 / 500 / 600 / 700 |
| Primary | Invoicery Blue `#04567D` (ramp 10–80, 60 is brand) |
| Secondary | Orange `#FF8800` |
| Accents | Ocean `#34A8C5` · Success `#0BC980` · Amazonas `#20B098` · Korall `#EB6060` · Error `#DB1212` |
| Type scale | H1 46/56 → Overline 10/16, with a mobile step-down |
| Spacing | 8 · 12 · 16 · 24 · 32 · 40 · 48 · 56 · 64 · 72 · 80 · 86 · 96 · 112 · 128 |
| Grid | 12 columns · **1280** content · 24 margin · 16 gutter |
| Breakpoints | xsmall 0–479 · small 480–1023 · medium 1024–1439 · large 1440+ |
| Elevation | default `0 2px 10px /15%` · hover `0 0 20px /20%` · pressed `0 8px 15px /20%` |

**Never write a raw colour.** Use a token. `payroll-check.cjs` fails on any
hex outside the system and on any `var(--x)` that resolves to nothing — the
latter caught `--purplebg`, which was being used after its definition was
removed, so those badges were rendering with no background at all.

The system has **no purple**. The Workforce Management and Excel-import
accents use Ocean, its fourth accent.

### Components

| Class | From | Notes |
|---|---|---|
| `.ds-table` / `.tbl` | 20_Tabell | Blue semibold headers on `gray-10`, no vertical rules, `primary-10` zebra |
| `.ds-icon-btn` | 20_Tabell | Circular blue outline, as the Ändra / Tar bort column |
| `.ds-field` / `.ig` | 19_Dropdown, 12_Inputfalt | Notched outline — the label sits in a gap in the top border |
| `.ds-menu` | 19_Dropdown | Open menu is solid `primary-60` with white items, square |
| `.ds-stepper` | 22_Steg-Indikator | Vertical, three states: upcoming · active · done |

`.tbl` and `.ig` are aliased to the components, so every existing table and
field picked them up without a markup change. A bare `.inp` (search boxes,
filters) is styled too — those have no `.ig` wrapper and were briefly
unstyled when the old rule was removed.

The stepper drives the Excel import, which is genuinely three steps: choose
a file, review the rows, confirm. `IMPORT_STEP` is display state only; the
data still lives in `IMPORT_STATE`.

**One deviation from the source.** 19_Dropdown draws the *error* state with a
blue border, identical to focus. Every other error affordance in the system
uses Error red, so `.ds-field[data-error]` uses red. Change it if blue was
the intent.

### How it reaches the existing CSS

Both apps carry ~1000 lines of CSS keyed to legacy names (`--navy`,
`--orange`, `--bg`). The LEGACY ALIASES block at the bottom of
`ib-design.css` re-points those at the real brand tokens, so every existing
rule picked up the palette without being edited. New work uses the token
names directly.

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
| Default language | Danish (`da`) | Bokmål (`nb`) |
| Money locale | `da-DK`, DKK, `33.000 kr.` | `nb-NO`, NOK, `49 800 kr` |
| Assignment | opgave, `OPG-2026-001` | oppdrag, `OPP-2026-001` |
| Company reg | CVR-nummer | Organisasjonsnummer |
| Person id | CPR-nummer | Fødselsnummer |
| Storage keys | `IB_DK_*` | `IB_NO_*` |

Switching business swaps currency, rates, legal entity **and dataset**. The two
markets are separate legal entities with separate books, so they share no data.
A logged-in user switching business has their session ended rather than carried
across the books; an anonymous visitor on the marketing page is redrawn in
place, because there is no session to end and a reload would only throw their
scroll position away.

### Business and language are separate choices

They used to be one: the market decided the language. They are now independent,
because a Danish company may want the interface in English and a Norwegian
administrator may be reading the Danish books.

| | Business (portal) | Language |
|---|---|---|
| Stored in | `IB_MARKET` | `IB_LANG` |
| Values | `DK`, `NO` | `en`, `da`, `nb` |
| Read with | `IB.marketCode()` | `IB.language()` |
| Set with | `IB.setMarket(code)` | `IB.setLanguage(code)` |
| Decides | entity, currency, rates, payroll model, dataset | interface copy, date format |

`IB.language()` falls back to the market's default when nothing is stored, so a
first-time Danish visitor still lands in Danish. Once chosen, the language
survives a business switch — `scripts/render-smoke.cjs` asserts this.

**Drawing the two controls.** A flag on its own reads as "language" to most
people, which is the confusion the whole design exists to prevent. So the
business control always carries the country *name* beside the flag and sits
under a "Business" label; the language control is letters only, never a flag.
Both live in `.l-topbar`, a strip above the nav, so the nav stays navigation.

**Which locale formats what.** Money follows the *market* — an amount belongs
to the entity's books, so a DKK figure is grouped the Danish way whoever is
reading. Dates follow the *language* (`IB.uiLocale()`), because a date is
prose; `en` maps to `en-GB`, not `en-US`, since the product is day-first
throughout. Stored data such as an assignment's `period` (`"Mars 2026"`) is
data, not UI: it stays as entered.

**Flags are drawn, not typed.** Windows ships no flag-emoji font, so
🇩🇰 renders as the letters "DK" in two boxes. Each market therefore carries a
`flagSVG`, served through `IBMarkets.flagHTML(code)`. Those SVGs are constants
in `ib-markets.js` — never user input — which is why they are injected as HTML.
Their hex values are flag specifications, not theme colours: they are the one
place in the codebase that must *not* be pulled into the design system.

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
markup). Every key must exist in **all three** languages — a missing key
renders as `⟦key⟧` rather than silently falling back, and the smoke test
fails on it. `scripts/payroll-check.cjs` reads the language list off
`IBi18n.STRINGS` rather than a hardcoded pair, so a fourth language is covered
the moment it is added.

**3. Never interpolate user data into HTML without `IB.esc()`.**
Every view builds markup with template strings and assigns via `innerHTML`.
Anything a user typed or that came out of storage — `description`, names,
emails, `period`, `adminNote` — goes through `esc()`, including inside
`onclick="fn('${...}')"` and `data-*` attributes.

**4. The schema is English; the UI is Danish, Norwegian or English.**
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
