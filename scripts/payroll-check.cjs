#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   payroll-check.cjs — payroll correctness and parity guard

   Runs three checks:

     1. GOLDEN     Known-good breakdowns for the seeded uppdrag, computed by
                   hand from the statutory model. Catches any silent drift in
                   calcPayroll.
     2. INVARIANTS Algebraic properties that must hold for any input.
     3. PARITY     Greps both HTML files for inline rate literals and local
                   payroll arithmetic. Any hit means a view is computing money
                   on its own again instead of calling IB.calcPayroll — which
                   is exactly how the consultant payslip and the admin payroll
                   run drifted 8 676 kr apart.

   Exit 0 = clean. Exit 1 = something to fix.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IB = require(path.join(ROOT, 'ib-core.js'));

let failures = 0;
let checks = 0;

const red = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

function ok(label, detail) {
  checks++;
  console.log(`  ${green('PASS')} ${label}${detail ? dim('  ' + detail) : ''}`);
}
function fail(label, expected, actual) {
  checks++;
  failures++;
  console.log(`  ${red('FAIL')} ${label}`);
  console.log(`       expected ${expected}`);
  console.log(`       actual   ${actual}`);
}
function near(label, actual, expected, tol) {
  const t = tol === undefined ? 0.01 : tol;
  if (Math.abs(actual - expected) <= t) ok(label, `${IB.round2(actual)}`);
  else fail(label, IB.round2(expected), IB.round2(actual));
}

/* ═══════════════════ 1. GOLDEN VALUES ═══════════════════
   Hand-derived from the statutory model for fakturabelopp = 43 200 kr:

     serviceavgift     = 43200 x 0,06        =  2 592,00
     lonebas           = 43200 - 2592        = 40 608,00
     bruttolon         = 40608 / 1,3142      = 30 899,41
     arbetsgivaravgift = 40608 - 30899,41    =  9 708,59
     preliminarskatt   = 30899,41 x 0,32     =  9 887,81
     nettolon          = 30899,41 - 9887,81  = 21 011,60
     moms              = 43200 x 0,25        = 10 800,00
     fakturatotal      = 43200 + 10800       = 54 000,00                    */
console.log(bold('\nGOLDEN — UPP-2026-004, fakturabelopp 43 200 kr'));
{
  const p = IB.calcPayroll(43200);
  near('serviceavgift',     p.serviceavgift,     2592.00);
  near('lonebas',           p.lonebas,           40608.00);
  near('bruttolon',         p.bruttolon,         30899.41);
  near('arbetsgivaravgift', p.arbetsgivaravgift, 9708.59);
  near('preliminarskatt',   p.preliminarskatt,   9887.81);
  near('nettolon',          p.nettolon,          21011.60);
  near('moms',              p.moms,              10800.00);
  near('fakturatotal',      p.fakturatotal,      54000.00);
}

/* ═══════════════════ 2. INVARIANTS ═══════════════════ */
console.log(bold('\nINVARIANTS — must hold for any fakturabelopp'));
{
  const samples = [0, 1, 14160, 24960, 27200, 43200, 999999.99];
  let allOk = true;
  const problems = [];

  samples.forEach(belopp => {
    const p = IB.calcPayroll(belopp);

    // The employer pot is fully accounted for: gross + employer fees.
    if (Math.abs((p.bruttolon + p.arbetsgivaravgift) - p.lonebas) > 0.005) {
      allOk = false;
      problems.push(`${belopp}: bruttolon + arbetsgivaravgift != lonebas`);
    }
    // Employer fee really is the stated rate ON the gross salary.
    if (Math.abs(p.arbetsgivaravgift - p.bruttolon * IB.RATES.arbetsgivaravgift) > 0.005) {
      allOk = false;
      problems.push(`${belopp}: arbetsgivaravgift is not ${IB.RATES.arbetsgivaravgift} x bruttolon`);
    }
    // Invoice splits cleanly into fee and salary pot.
    if (Math.abs((p.serviceavgift + p.lonebas) - p.fakturabelopp) > 0.005) {
      allOk = false;
      problems.push(`${belopp}: serviceavgift + lonebas != fakturabelopp`);
    }
    // Net + tax reconstitutes gross.
    if (Math.abs((p.nettolon + p.preliminarskatt) - p.bruttolon) > 0.005) {
      allOk = false;
      problems.push(`${belopp}: nettolon + preliminarskatt != bruttolon`);
    }
    // Nothing goes negative.
    Object.keys(p).forEach(k => {
      if (p[k] < 0) { allOk = false; problems.push(`${belopp}: ${k} is negative`); }
    });
    // Consultant never nets more than the salary pot.
    if (p.nettolon > p.lonebas + 0.005) {
      allOk = false;
      problems.push(`${belopp}: nettolon exceeds lonebas`);
    }
  });

  if (allOk) ok('all algebraic invariants hold', `${samples.length} samples`);
  else problems.forEach(pr => fail(pr, 'invariant to hold', 'violated'));
}

/* Batch must equal the sum of its parts — no rounding applied mid-chain. */
console.log(bold('\nBATCH — aggregation must not round mid-chain'));
{
  const list = IB.seedUppdrag();
  const batch = IB.calcPayrollBatch(list);
  const manual = list.reduce((a, u) => a + IB.calcPayroll(u.belopp).nettolon, 0);
  near('batch nettolon equals sum of individual nettolon', batch.nettolon, manual, 0.000001);
  near('batch antal', batch.antal, list.length, 0);
}

/* ═══════════════════ 3. PARITY — no local money math in views ═══════════════════ */
console.log(bold('\nPARITY — views must not compute money themselves'));
{
  const files = ['invoicery-business.html', 'invoicery-business-admin.html'];

  // Rate literals that must only ever appear in ib-core.js.
  const rateLiterals = [
    { re: /\*\s*0\.06\b/g,   what: 'serviceavgift 0.06' },
    { re: /\*\s*0\.3142\b/g, what: 'arbetsgivaravgift 0.3142' },
    { re: /\*\s*0\.32\b/g,   what: 'preliminarskatt 0.32' },
    { re: /\*\s*1\.25\b/g,   what: 'moms 1.25' },
    { re: /\*\s*0\.25\b/g,   what: 'moms 0.25' },
    { re: /\*\s*0\.94\b/g,   what: 'pre-multiplied net-of-fee 0.94' }
  ];

  files.forEach(f => {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) { fail(`${f} exists`, 'file present', 'missing'); return; }
    const src = fs.readFileSync(full, 'utf8');
    const lines = src.split(/\r?\n/);

    const hits = [];
    rateLiterals.forEach(({ re, what }) => {
      lines.forEach((line, i) => {
        re.lastIndex = 0;
        if (re.test(line)) hits.push(`${f}:${i + 1} — inline ${what}`);
      });
    });

    if (hits.length === 0) ok(`${f} has no inline rate literals`);
    else hits.forEach(h => fail(h, 'IB.calcPayroll(...)', 'hardcoded rate in a view'));
  });
}

/* ═══════════════════ 4. IDENTIFIER SAFETY ═══════════════════
   The sparaKonsult() landmine: Cyrillic/Greek homoglyphs inside identifiers.
   Swedish aao are fine; Cyrillic a/p/e/o are not. */
console.log(bold('\nIDENTIFIERS — no confusable homoglyphs'));
{
  const files = ['invoicery-business.html', 'invoicery-business-admin.html', 'ib-core.js'];
  const confusable = /[Ѐ-ӿͰ-Ͽ]/;   // Cyrillic, Greek

  let clean = true;
  files.forEach(f => {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) return;
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (confusable.test(line)) {
        clean = false;
        const chars = [...line].filter(c => confusable.test(c))
          .map(c => `${c} (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
        fail(`${f}:${i + 1} — confusable character in source`,
             'ASCII or Swedish aao', [...new Set(chars)].join(', '));
      }
    });
  });
  if (clean) ok('no Cyrillic or Greek homoglyphs in source');
}

/* ═══════════════════ SUMMARY ═══════════════════ */
console.log('');
if (failures === 0) {
  console.log(green(bold(`  ${checks} checks passed.`)));
  process.exit(0);
} else {
  console.log(red(bold(`  ${failures} of ${checks} checks FAILED.`)));
  process.exit(1);
}
