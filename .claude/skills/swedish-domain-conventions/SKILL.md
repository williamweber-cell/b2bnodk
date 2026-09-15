---
name: swedish-domain-conventions
description: Terminology, sv-SE formatting, status values and identifier safety rules for Invoicery Business. Load when writing UI copy, view functions, data fields, or any identifier in this codebase.
user-invocable: false
---

# Swedish domain conventions — Invoicery Business

The product is Swedish. UI copy, data field names and most identifiers are in
Swedish. Do not anglicise them — `uppdrag` is the domain term the customer
uses, "assignment" is not.

## Vocabulary

| Swedish | English | Notes |
|---|---|---|
| uppdrag | assignment / engagement | The core record. Plural is also *uppdrag*. |
| konsult | consultant | Employed by Invoicery Business, not a contractor |
| företag | client company | The one receiving the work and the invoice |
| lönekörning | payroll run | |
| lönespecifikation / lönespec | payslip | |
| arbetsgivarintyg | employment certificate | For loan, tenancy or a-kassa applications |
| arbetsgivaravgift | employer social contributions | |
| preliminärskatt | withheld preliminary income tax | |
| serviceavgift | the Invoicery Business fee | |
| lönebas | salary pot after the fee, before employer fees | **not** bruttolön |
| bruttolön | gross salary | after employer fees, before tax |
| nettolön | net salary | what actually lands in the account |
| orgnr | company registration number | format `NNNNNN-NNNN` |
| personnummer | personal identity number | format `YYYYMMDD-NNNN`, highly sensitive |
| moms | VAT | 25 % standard |
| jämkning | tax adjustment decision | from Skatteverket |
| a-kassa | unemployment insurance fund | |

## Status values

Persisted in `localStorage` and compared by string equality — **the diacritics
are part of the value.** Use `IB.STATUS` constants, never retype the literal.

```js
IB.STATUS.UTKAST    // 'utkast'
IB.STATUS.VANTAR    // 'väntar_godkännande'
IB.STATUS.GODKANT   // 'godkänt'
IB.STATUS.UTBETALT  // 'utbetalt'
IB.STATUS.AVVISAT   // 'avvisat'
```

Service types likewise via `IB.TYP`: `SalaryInvoicing`, `Excel-import`,
`API-integration`, `Workforce Management`.

## Formatting

Always `sv-SE`. Never hand-roll.

```js
IB.fmtN(27200)   // '27 200 kr'   ← default for amounts in tables
IB.fmt(27200)    // '27 200 kr' as currency style
IB.fmtDate(d)    // '2026-04-01'
IB.today()       // '2026-04-01'  ISO, for storage
```

Swedish uses a **space** as thousands separator and a **comma** as decimal
separator — `31,42 %`, `27 200 kr`. Write rate labels in UI copy the Swedish
way (`31,42%`), even though the code constant is `0.3142`.

Dates in storage are ISO `YYYY-MM-DD`. Dates in UI go through `fmtDate`.

## Identifier safety

Swedish characters in identifiers are **allowed** and already present:
`köraEnLon`, `begärÄndring`, `timlön`, `godkändDatum`, `nettolöner`. Keep
them; renaming would churn the whole codebase for no gain.

What is **forbidden** is Cyrillic and Greek homoglyphs. `sparaKonsult` was
written as `sp` + Cyrillic **а р а** + `Konsult` (U+0430, U+0440, U+0430). It
worked only because the function definition and its `onclick` call site were
copy-pasted from the same poisoned source. Retyping either one in Latin would
have produced a dead Save button with no error anyone could see.

This happens when code is pasted from a rendered page, a chat window, or a
document. `scripts/payroll-check.cjs` scans for it.

## Copy tone

The existing landing page voice: direct, concrete, no superlatives. Trust
markers are plain statements — "Inga dolda avgifter", "Fullt arbetsgivaransvar".
Match it. Avoid exclamation marks outside confirmation states.

## PII

`personnummer`, `orgnr`, salary history and arbetsgivarintyg are personal
data under GDPR, and Swedish payroll data sits at the sensitive end. Never
log it, never put it in a URL or query string, never write it anywhere it was
not already stored. See the `pii-compliance-reviewer` agent.
