---
name: nordic-domain-conventions
description: Danish and Norwegian terminology, locale formatting, i18n rules and identifier safety for Invoicery Business. Load when writing UI copy, view functions, translation keys, data fields, or any identifier in this codebase.
user-invocable: false
---

# Nordic domain conventions — Invoicery Business

Two markets: **Denmark** (Danish, `da-DK`, DKK) and **Norway** (bokmål,
`nb-NO`, NOK). Sweden was dropped — no Swedish copy or SE rate belongs
anywhere in this codebase.

## The i18n rule

No user-visible string is written inline. Ever.

```js
// templates
`<span>${esc(t('lbl.consultant'))}</span>`

// static markup
<div data-i18n="nav.c.dash">Oversigt</div>
```

Every key must exist in **both** `da` and `nb` in `ib-i18n.js`. A missing key
renders as `⟦key⟧` — deliberately loud, because silent fallback to the other
language is how half-translated screens ship. `scripts/payroll-check.cjs`
fails on any key referenced but not defined; `render-smoke.cjs` fails on any
`⟦⟧` reaching rendered output.

Static markup carries Danish as its inline fallback (DK is the default
market); `applyI18n()` replaces it at runtime.

## Terminology — do NOT unify these

The two languages look similar and are not. Each market's customers use their
own word; translating one from the other produces copy that reads as foreign.

| Concept | Danish | Norwegian bokmål |
|---|---|---|
| assignment | **opgave** | **oppdrag** |
| consultant | konsulent | konsulent |
| client company | **virksomhed** | **bedrift** |
| payroll run | **lønkørsel** | **lønnskjøring** |
| payslip | **lønseddel** | **lønnsslipp** |
| employment certificate | **ansættelsesbevis** | **arbeidsbekreftelse** |
| gross salary | bruttoløn | brutto**lønn** |
| net salary | nettoløn | netto**lønn** |
| withheld tax | **A-skat** | **forskuddstrekk** |
| labour-market contribution | **AM-bidrag** | — (no equivalent) |
| employer contribution | — (ATP, fixed) | **arbeidsgiveravgift** (%) |
| holiday pay | **feriegodtgørelse** (12,5 %) | **feriepenger** (10,2 %) |
| company reg. number | **CVR-nummer** | **organisasjonsnummer** |
| personal id | **CPR-nummer** | **fødselsnummer** |
| VAT | **moms** | **mva** |
| unemployment fund | **a-kasse** | **dagpenger (NAV)** |
| approved | godkendt | godkjent |
| pending | afventer godkendelse | venter på godkjenning |
| paid out | udbetalt | utbetalt |
| rejected | afvist | avvist |
| draft | kladde | utkast |

Norwegian doubles the *n* in lønn-compounds (`lønnskjøring`, `bruttolønn`);
Danish does not (`lønkørsel`, `bruttoløn`). This is the single most common
mistake when copying one language's block to the other.

## Status and type values

Language-neutral keys, persisted and compared by equality. Never retype the
literal; never localise the stored value.

```js
IB.STATUS.DRAFT     // 'draft'
IB.STATUS.PENDING   // 'pending'
IB.STATUS.APPROVED  // 'approved'
IB.STATUS.PAID      // 'paid'
IB.STATUS.REJECTED  // 'rejected'
```

Display label comes from `t('status.' + status)`.

Service types (`IB.TYPE`) are product names — `SalaryInvoicing`,
`Excel-import`, `API-integration`, `Workforce Management` — and stay untranslated.

## Schema is English

`consultantId`, `consultantName`, `companyId`, `companyName`, `description`,
`hours`, `hourlyRate`, `amount`, `period`, `status`, `createdDate`,
`approvedDate`, `adminNote`, `regNumber`.

A two-market data model must not be written in either market's language. The
previous schema was Swedish (`konsultId`, `timlön`, `godkändDatum`) for a
market the product no longer serves.

## Formatting

Always market-aware. Never hand-roll, never hardcode a currency symbol.

```js
IB.fmtN(33000)    // DK: '33.000 kr.'   NO: '33 000 kr'
IB.fmtDate(d)     // DK: '1.4.2026'     NO: '1.4.2026'
IB.fmtPct(0.141)  // '14,1 %'
IB.today()        // '2026-04-01'  ISO, for storage
```

Danish groups thousands with `.` and Norwegian with a space — this falls out
of `toLocaleString(market.locale)` and must not be reimplemented.

In UI copy write rates the Nordic way: `14,1 %`, `12,5 %`. The code constant
is still `0.141`.

## Identifier safety

Nordic æ ø å ä ö are allowed in strings, comments and UI copy. Identifiers
should be ASCII.

Forbidden outright: Cyrillic and Greek homoglyphs. `sparaKonsult` was written
as `sp` + Cyrillic **а р а** + `Konsult` (U+0430, U+0440, U+0430) and worked
only because the definition and its `onclick` call site were pasted from the
same poisoned source. Retyping either in Latin would have produced a dead
button with no visible error. This happens when code is pasted from a rendered
page, a chat window or a document.

## PII

`CPR-nummer`, `fødselsnummer`, `CVR`, `organisasjonsnummer`, salary history
and employment certificates are personal data under GDPR, and Nordic payroll
data sits at the sensitive end. Never log it, never put it in a URL, never
write it anywhere it was not already stored. See the `pii-compliance-reviewer`
agent.
