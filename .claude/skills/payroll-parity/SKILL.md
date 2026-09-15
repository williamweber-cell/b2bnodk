---
name: payroll-parity
description: Verify payroll correctness — golden values, algebraic invariants, no inline rate literals in views, no homoglyph identifiers. Run before committing anything that touches money.
disable-model-invocation: true
---

# /payroll-parity

Run the guard:

```bash
node scripts/payroll-check.cjs
```

Report the output. If it exits 0, say so plainly and stop.

## If it fails

Each failure category has one correct fix. Do not work around the check.

### `inline <rate> in a view`

A view is computing money itself. Replace it:

```js
// before
const avgift = u.belopp * 0.06;
const brutto = u.belopp - avgift;

// after
const p = IB.calcPayroll(u.belopp);
// p.serviceavgift, p.lonebas, p.bruttolon, p.arbetsgivaravgift,
// p.preliminarskatt, p.nettolon, p.moms, p.fakturatotal
```

For a total across several uppdrag use `IB.calcPayrollBatch(list)` rather
than summing formatted values or re-deriving the total.

### `confusable character in source`

A Cyrillic or Greek homoglyph is sitting inside an identifier. The report
names the file, line and the exact codepoint. Replace it with the ASCII
letter it imitates. Check both the definition and every call site — they are
usually pasted together and both poisoned.

### A golden value moved

`calcPayroll` changed behaviour. Either the change was wrong, or a statutory
rate genuinely changed and the golden values in `scripts/payroll-check.cjs`
need updating alongside it — with the new derivation written out in the
comment above them, the way the existing one is.

Never update a golden value to match a new output without first deriving by
hand what the output *should* be. That is how the original 8 676 kr
discrepancy would have been ratified instead of caught.

### An invariant broke

An algebraic property of the model no longer holds — gross plus employer
fees no longer reconstitutes the pot, or something went negative. This is
almost always a real bug in `calcPayroll`, not a stale test. Read the
`payroll-domain` skill and re-derive.
