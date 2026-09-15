---
name: payroll-domain
description: Danish and Norwegian umbrella-employment payroll models for Invoicery Business — the two calculation chains, statutory rates, rounding policy, and which module is authoritative. Load before touching any code that computes or displays amounts, fees, tax, gross, net, VAT, holiday pay or employer contributions.
user-invocable: false
---

# Payroll domain — Invoicery Business

## The one rule

`ib-markets.js` owns every rate and every calculation. Views call
`IB.calcPayroll(amount, {hours})` or `IB.calcPayrollBatch(list)` and read
fields off the result. A view never multiplies by a rate.

This matters more here than in a single-market product: **Denmark and Norway
use structurally different chains.** An inlined rate is not merely duplicated —
it is wrong in at least one market by construction.

Enforced by `scripts/payroll-check.cjs` and the PostToolUse hook.

## Why the rule exists

The predecessor to this codebase computed payroll independently in the
consultant payslip and the admin payroll run. They disagreed by 8 676 kr on a
single assignment, and both were wrong. The fix was one authoritative module;
keep it that way.

## Shared prefix

```
invoiceAmount = hours × hourlyRate          (excl. VAT)
vat           = invoiceAmount × 0,25
invoiceTotal  = invoiceAmount + vat         ← the client pays this
serviceFee    = invoiceAmount × 0,06
salaryBase    = invoiceAmount − serviceFee  ← the employer's pot
```

## Norway — `model: 'no'`

Arbeidsgiveravgift is levied **on top of** gross salary, and also on the
feriepenger accrued on it. So gross is backed **out** of the pot by division:

```
salaryBase = gross × (1 + 0,102) × (1 + 0,141)
⇒ gross    = salaryBase / 1,257382

feriepenger        = gross × 0,102      accrued, paid the following year
arbeidsgiveravgift = (gross + feriepenger) × 0,141
forskuddstrekk     = gross × 0,32
net                = gross − forskuddstrekk
```

`salaryBase × (1 − 0,141)` is wrong. Multiplying instead of dividing
understates gross salary and therefore the consultant's take-home.

Arbeidsgiveravgift is **geographically zoned** in Norway, 14,1 % down to 0 %
depending on the employee's work municipality. The flat sone-1 rate here is a
simplification that must be resolved per employee before production.

## Denmark — `model: 'dk'`

There is no large employer percentage. ATP is a fixed krone amount, and
**AM-bidrag is an employee deduction taken before A-skat** — that ordering is
the distinctive part and the easiest thing to get wrong.

```
gross = (salaryBase − ATP_employer) / (1 + 0,125 + 0,015)

feriegodtgørelse = gross × 0,125
øvrige bidrag    = gross × 0,015        AUB/AER, AES, barsel.dk
ATP_employee     fixed krone amount
AM-bidrag        = (gross − ATP_employee) × 0,08
A-skat           = (gross − ATP_employee − AM-bidrag) × 0,38
net              = gross − ATP_employee − AM-bidrag − A-skat
```

A-skat is **not** levied on the AM-bidrag. Computing
`A-skat = gross × 0,38` overstates withholding by about 3 % of gross.

ATP is a fixed monthly amount pro-rated against a full-time month (160,33 h),
so **pass `{hours}`**. Omitting it charges a full month's ATP to a four-hour
assignment. An assignment too small to carry the fixed ATP has the employer
share capped at the salary base rather than producing a negative net.

## The reconciliation invariants

Both models must satisfy, exactly, for any input:

```
gross + employerCost        === salaryBase
gross − employeeDeductions  === net
serviceFee + salaryBase     === invoiceAmount
invoiceAmount + vat         === invoiceTotal
```

If a change breaks one of these, the change is wrong — not the invariant.

## Rates are unverified

Every market carries `verified: false`, and the admin UI shows a standing
warning until it flips. The rates are plausible values used to build and test
the structure. They have not been confirmed against Skattestyrelsen,
Skatteetaten, ATP or the company's own payroll operation.

Do not remove the warning, and do not tell anyone these numbers are correct.

Per-consultant resolution still to come:
- Norwegian arbeidsgiveravgift by work-location zone
- Danish A-skat from the individual's skattekort (trækprocent + fradrag)
- Danish feriegodtgørelse 12,5 % applies to hourly workers; salaried staff
  with paid holiday accrue 2,08 days/month instead
- Norwegian feriepenger 12 % at five weeks, +2,3 % for employees over 60

`calcPayroll(amount, market, opts)` takes a per-call override object for
exactly this.

## Rounding

Calculate in full precision. Round only in `fmt` / `fmtN` at display.

Rounding mid-chain causes øre drift that compounds — across a 60-assignment
payroll run it produces a total that does not reconcile against the sum of the
payslips, which is the kind of discrepancy an accountant finds and you explain.

`IB.round2()` is for assertions, never for display and never as an
intermediate step.

## Adding a money field to a view

1. `const p = IB.calcPayroll(a.amount, {hours: a.hours});`
2. Read `p.invoiceAmount`, `p.vat`, `p.invoiceTotal`, `p.serviceFee`,
   `p.salaryBase`, `p.gross`, `p.holidayPay`, `p.employerCost`,
   `p.employeeDeductions`, `p.withholding`, `p.net`, or market-specific
   values from `p.detail`.
3. To render a full breakdown, iterate `p.lines` — each carries a
   translation `key`, an `amount` and a `sign`. The view then does not need
   to know which market's model produced it.
4. Format with `fmtN()`, label with `t()`.
5. Run `node scripts/payroll-check.cjs`.

If you need a number `calcPayroll` doesn't return, add it there with an
invariant in the check script. Never compute it in the view.
