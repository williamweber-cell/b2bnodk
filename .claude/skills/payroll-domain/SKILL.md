---
name: payroll-domain
description: Swedish umbrella-employment payroll rules for Invoicery Business — statutory rates, calculation order, rounding policy, and which module is authoritative. Load before touching any code that computes or displays belopp, avgift, skatt, social, brutto, netto, moms, lönebas or arbetsgivaravgift.
user-invocable: false
---

# Payroll domain — Invoicery Business

## The one rule

`ib-core.js` owns every rate and every calculation. Views call
`IB.calcPayroll(belopp)` or `IB.calcPayrollBatch(list)` and read fields off
the returned object. A view never multiplies by a rate.

This is enforced by `scripts/payroll-check.cjs`, which greps both HTML files
for rate literals and fails the build on a hit.

## Why the rule exists

The consultant payslip (`kLon`) and the admin payroll run (`aLon`) each
implemented the calculation independently and disagreed:

| | 43 200 kr uppdrag |
|---|---|
| Consultant payslip showed | 27 613 kr |
| Admin payroll run showed | 18 937 kr |
| Actually correct | **21 012 kr** |

Both were wrong, in opposite directions, on the same record. A consultant
reading their payslip and an administrator reading the payroll run saw
numbers 8 676 kr apart.

## The calculation

```
fakturabelopp     = timmar × timlön                 (excl. moms)
moms              = fakturabelopp × 0,25
fakturatotal      = fakturabelopp + moms            ← client pays this

serviceavgift     = fakturabelopp × 0,06
lönebas           = fakturabelopp − serviceavgift   ← employer's pot

bruttolön         = lönebas / 1,3142
arbetsgivaravgift = lönebas − bruttolön

preliminärskatt   = bruttolön × 0,32
nettolön          = bruttolön − preliminärskatt     ← consultant receives this
```

### The part that is easy to get wrong

Arbetsgivaravgift is levied **on top of** gross salary. It is not a slice of
the employer's pot. So gross salary is obtained by **dividing** the pot:

```
lönebas = bruttolön + (bruttolön × 0,3142) = bruttolön × 1,3142
⇒ bruttolön = lönebas / 1,3142
```

`lönebas × (1 − 0,3142)` is wrong. It understates gross salary, and therefore
understates the consultant's take-home pay, by roughly 4 % of the pot.

### Naming, which was also transposed

- **lönebas** — what remains after the service fee, before employer fees.
  Not "bruttolön".
- **bruttolön** — the consultant's gross salary, after employer fees are
  carved out, before tax.

The landing-page calculator and the admin summary panel both had these
labels swapped.

## Rates

| Rate | Value | Constant |
|---|---|---|
| Serviceavgift | 6 % | `IB.RATES.serviceavgift` |
| Arbetsgivaravgift | 31,42 % | `IB.RATES.arbetsgivaravgift` |
| Preliminärskatt | 32 % | `IB.RATES.preliminarskatt` |
| Moms | 25 % | `IB.RATES.moms` |

Arbetsgivaravgift and preliminärskatt are **simplified flat rates**. Before
production they need per-consultant resolution:

- Arbetsgivaravgift has reduced brackets for employees born 2003 or later
  (ungdomsrabatt) and for those who turned 66 before the income year began.
- Preliminärskatt comes from the individual's skattetabell or a jämkningsbeslut
  from Skatteverket. A flat 32 % is a demo approximation, not a real
  withholding.

`IB.calcPayroll(belopp, overrides)` takes a per-call override object for
exactly this — pass `{arbetsgivaravgift: 0.1021, preliminarskatt: 0.29}` when
per-consultant rates arrive.

## Rounding

Calculate in full precision. Round only in `fmt` / `fmtN` at display time.

Rounding mid-chain causes öre drift that compounds — across a 60-uppdrag
lönekörning it produces a payroll total that does not reconcile against the
sum of the payslips, which is the kind of discrepancy an accountant will
find and you will not enjoy explaining.

`IB.round2()` exists for assertions and comparisons, not for display and
never as an intermediate step.

## When adding a money field to a view

1. Call `IB.calcPayroll(u.belopp)` once, assign to `p`.
2. Read `p.serviceavgift`, `p.lonebas`, `p.bruttolon`,
   `p.arbetsgivaravgift`, `p.preliminarskatt`, `p.nettolon`, `p.moms`,
   `p.fakturatotal`, `p.fakturabelopp`.
3. Format with `fmtN()`.
4. Run `node scripts/payroll-check.cjs`.

If you need a number that `calcPayroll` does not return, add it to
`calcPayroll` with an invariant in the check script. Do not compute it in
the view.
