---
name: payroll-parity
description: Verify payroll correctness across both markets — golden values, reconciliation invariants, no inline rates, complete translations, no homoglyphs. Run before committing anything that touches money or copy.
disable-model-invocation: true
---

# /payroll-parity

Run both guards:

```bash
node scripts/payroll-check.cjs
node scripts/render-smoke.cjs
```

Report the output. If both exit 0, say so plainly and stop.

## If it fails

Each category has one correct fix. Do not work around the check.

### `inline <rate> in a view`

A view is computing money. Replace it:

```js
const p = IB.calcPayroll(a.amount, {hours: a.hours});
// p.serviceFee, p.salaryBase, p.gross, p.holidayPay, p.employerCost,
// p.employeeDeductions, p.withholding, p.net, p.vat, p.invoiceTotal
// p.detail.*  — market-specific (employerTax, atpEmployer, amContribution)
// p.lines     — ordered breakdown, each {key, amount, sign}
```

Denmark and Norway have different chains, so a literal rate is wrong in at
least one market. Use `IB.calcPayrollBatch(list)` for totals — never sum
formatted values.

### A golden value moved

`calcPayroll` changed behaviour. Either the change is wrong, or a statutory
rate genuinely changed and the golden values need updating alongside it, with
the new derivation written out in the comment the way the existing two are.

Never update a golden value to match new output without first deriving by hand
what the output *should* be. That is how a real discrepancy gets ratified
instead of caught.

### An invariant broke

`gross + employerCost !== salaryBase`, or
`gross − employeeDeductions !== net`. These are algebraic properties of the
models, not test expectations. A break is almost always a real bug in
`calcPayroll`. Read the `payroll-domain` skill and re-derive.

### An untranslated marker in rendered output

A translation key is referenced but not defined. Add it to **both** `da` and
`nb` in `ib-i18n.js` — the check requires parity, deliberately, so a
half-translated screen cannot ship.

Norwegian doubles the *n* in lønn-compounds (`lønnskjøring`, `bruttolønn`);
Danish does not (`lønkørsel`, `bruttoløn`). See `nordic-domain-conventions`
before writing the copy.

### `Swedish text remains`

Leftover copy from before the DK/NO migration. Replace it with a `t('key')`
call or a `data-i18n` attribute and add the key to both languages.

### `confusable character in source`

A Cyrillic or Greek homoglyph inside an identifier. The report names the file,
line and codepoint. Replace with the ASCII letter it imitates, and check every
call site — they are usually pasted together and both poisoned.
