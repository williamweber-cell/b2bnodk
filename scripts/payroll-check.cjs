#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   payroll-check.cjs — correctness, parity and i18n guard

     1. GOLDEN      Hand-derived breakdowns per market. Denmark and Norway
                    have structurally different chains, so each is checked
                    against its own derivation.
     2. INVARIANTS  Algebraic properties that must hold for any input, in
                    both models. The employer side must reconcile to the
                    salary base and the employee side to net pay.
     3. PARITY      No rate literal and no local money math in a view.
     4. I18N        Both languages complete; every key referenced by the
                    markup or the app code exists.
     5. IDENTIFIERS No Cyrillic or Greek homoglyphs in source.

   Exit 0 = clean.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// localStorage shim so ib-core can boot outside a browser.
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

const M = require(path.join(ROOT, 'ib-markets.js'));
const I = require(path.join(ROOT, 'ib-i18n.js'));
const IB = require(path.join(ROOT, 'ib-core.js'));

let failures = 0, checks = 0;
const red = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

function ok(l, d) { checks++; console.log(`  ${green('PASS')} ${l}${d ? dim('  ' + d) : ''}`); }
function fail(l, e, a) {
  checks++; failures++;
  console.log(`  ${red('FAIL')} ${l}`);
  if (e !== undefined) { console.log(`       expected ${e}`); console.log(`       actual   ${a}`); }
}
function near(l, actual, expected, tol) {
  const t = tol === undefined ? 0.01 : tol;
  if (Math.abs(actual - expected) <= t) ok(l, String(IB.round2(actual)));
  else fail(l, IB.round2(expected), IB.round2(actual));
}

/* ═══════════════════ 1. GOLDEN ═══════════════════

   NORWAY, invoice 43 200 NOK, full-time month:
     servicegebyr      = 43200 x 0,06                    =  2 592,00
     lønnsbase         = 40 608,00
     bruttolønn        = 40608 / (1,102 x 1,141)         = 32 295,67
     feriepenger       = 32295,67 x 0,102                =  3 294,16
     arbeidsgiveravgift= (32295,67+3294,16) x 0,141      =  5 018,17
     forskuddstrekk    = 32295,67 x 0,32                 = 10 334,62
     nettolønn                                            = 21 961,06

   DENMARK, invoice 43 200 DKK, full-time month (160,33 h):
     servicegebyr      = 43200 x 0,06                    =  2 592,00
     lønbase           = 40 608,00
     ATP(arbejdsgiver) = 189,35 (full month)
     bruttoløn         = (40608 - 189,35) / 1,140        = 35 454,96
     feriegodtgørelse  = 35454,96 x 0,125                =  4 431,87
     øvrige bidrag     = 35454,96 x 0,015                =    531,82
     ATP(lønmodtager)  = 94,65
     AM-bidrag         = (35454,96 - 94,65) x 0,08       =  2 828,82
     A-skat            = (35360,31 - 2828,82) x 0,38     = 12 361,96
     nettoløn                                             = 20 169,52          */
console.log(bold('\nGOLDEN — Norway, 43 200 NOK'));
{
  const p = M.calcPayroll(43200, 'NO');
  near('servicegebyr',       p.serviceFee,   2592.00);
  near('lønnsbase',          p.salaryBase,   40608.00);
  near('bruttolønn',         p.gross,        32295.67);
  near('feriepenger',        p.holidayPay,   3294.16);
  near('arbeidsgiveravgift', p.detail.employerTax, 5018.17);
  near('forskuddstrekk',     p.withholding,  10334.62);
  near('nettolønn',          p.net,          21961.06);
}
console.log(bold('\nGOLDEN — Denmark, 43 200 DKK'));
{
  const p = M.calcPayroll(43200, 'DK', { hours: 160.33 });
  near('servicegebyr',      p.serviceFee,             2592.00);
  near('lønbase',           p.salaryBase,             40608.00);
  near('ATP arbejdsgiver',  p.detail.atpEmployer,     189.35);
  near('bruttoløn',         p.gross,                  35454.96);
  near('feriegodtgørelse',  p.holidayPay,             4431.87);
  near('øvrige bidrag',     p.detail.otherEmployer,   531.82);
  near('ATP lønmodtager',   p.detail.atpEmployee,     94.65);
  near('AM-bidrag',         p.detail.amContribution,  2828.82);
  near('A-skat',            p.withholding,            12361.96);
  near('nettoløn',          p.net,                    20169.52);
}

/* ═══════════════════ 2. INVARIANTS ═══════════════════ */
console.log(bold('\nINVARIANTS — both models, any input'));
{
  const samples = [0, 1, 10920, 16320, 20800, 43200, 999999.99];
  const problems = [];
  ['DK', 'NO'].forEach(code => {
    samples.forEach(amount => {
      const p = M.calcPayroll(amount, code, { hours: 160.33 });
      const tag = `${code} ${amount}`;
      // Employer side accounts for the whole salary base.
      if (Math.abs((p.gross + p.employerCost) - p.salaryBase) > 0.005)
        problems.push(`${tag}: gross + employerCost != salaryBase`);
      // Employee side reconstitutes net.
      if (Math.abs((p.gross - p.employeeDeductions) - p.net) > 0.005)
        problems.push(`${tag}: gross - employeeDeductions != net`);
      // Invoice splits into fee and salary base.
      if (Math.abs((p.serviceFee + p.salaryBase) - p.invoiceAmount) > 0.005)
        problems.push(`${tag}: serviceFee + salaryBase != invoiceAmount`);
      // VAT.
      if (Math.abs((p.invoiceAmount + p.vat) - p.invoiceTotal) > 0.005)
        problems.push(`${tag}: invoiceAmount + vat != invoiceTotal`);
      // Nothing negative, net never exceeds the base.
      ['serviceFee','salaryBase','gross','net','vat','holidayPay'].forEach(k => {
        if (p[k] < -0.005) problems.push(`${tag}: ${k} is negative`);
      });
      if (p.net > p.salaryBase + 0.005) problems.push(`${tag}: net exceeds salaryBase`);
      // Every displayed line must have a label in both languages.
      p.lines.forEach(l => {
        ['da','nb'].forEach(lang => {
          if (I.t(l.key, lang).startsWith('⟦')) problems.push(`${tag}: no ${lang} label for ${l.key}`);
        });
      });
    });
  });
  if (!problems.length) ok('all invariants hold', `${samples.length * 2} cases`);
  else [...new Set(problems)].forEach(p => fail(p));
}

/* Norway-specific: arbeidsgiveravgift is levied on gross PLUS feriepenger. */
console.log(bold('\nMODEL — market-specific properties'));
{
  const p = M.calcPayroll(50000, 'NO');
  const expect = (p.gross + p.holidayPay) * M.get('NO').rates.employerTax;
  near('NO: arbeidsgiveravgift on gross + feriepenger', p.detail.employerTax, expect, 0.005);

  // Denmark: AM-bidrag comes off before A-skat, not after.
  const d = M.calcPayroll(50000, 'DK', { hours: 160.33 });
  const amBase = d.gross - d.detail.atpEmployee;
  near('DK: AM-bidrag is 8% of gross less ATP', d.detail.amContribution,
       amBase * M.get('DK').rates.amContribution, 0.005);
  near('DK: A-skat base excludes AM-bidrag', d.withholding,
       (amBase - d.detail.amContribution) * M.get('DK').rates.withholding, 0.005);

  // ATP pro-rates with hours.
  const half = M.calcPayroll(50000, 'DK', { hours: 80 });
  near('DK: ATP pro-rates by hours', half.detail.atpEmployer,
       M.get('DK').fixed.atpEmployerMonthly * (80 / 160.33), 0.005);
}

/* Batch must equal the sum of its parts. */
console.log(bold('\nBATCH — no rounding mid-chain'));
['DK','NO'].forEach(code => {
  const list = IB.SEED[code].assignments;
  const batch = M.calcPayrollBatch(list, code);
  const manual = list.reduce((a, x) => a + M.calcPayroll(x.amount, code, { hours: x.hours }).net, 0);
  near(`${code}: batch net equals sum of individual net`, batch.net, manual, 0.000001);
});

/* ═══════════════════ 3. PARITY ═══════════════════ */
console.log(bold('\nPARITY — views must not compute money'));
{
  const files = ['invoicery-business.html', 'invoicery-business-admin.html'];
  const rates = [
    [/\*\s*0\.06\b/, 'serviceFee 0.06'],
    [/\*\s*0\.3142\b/, 'employer rate 0.3142'],
    [/\*\s*0\.141\b/, 'arbeidsgiveravgift 0.141'],
    [/\*\s*0\.102\b/, 'feriepenger 0.102'],
    [/\*\s*0\.125\b/, 'feriegodtgørelse 0.125'],
    [/\*\s*0\.08\b/, 'AM-bidrag 0.08'],
    [/\*\s*0\.32\b/, 'withholding 0.32'],
    [/\*\s*0\.38\b/, 'A-skat 0.38'],
    [/\*\s*1\.25\b/, 'vat 1.25'],
    [/\*\s*0\.25\b/, 'vat 0.25'],
    [/\/\s*1\.3142\b/, 'divisor 1.3142']
  ];
  files.forEach(f => {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) { fail(`${f} exists`, 'present', 'missing'); return; }
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    const hits = [];
    lines.forEach((line, i) => {
      if (/^\s*\.mkt|^\s*--/.test(line)) return;   // CSS
      rates.forEach(([re, what]) => {
        if (re.test(line)) hits.push(`${f}:${i + 1} — inline ${what}`);
      });
    });
    if (!hits.length) ok(`${f} has no inline rate literals`);
    else hits.forEach(h => fail(h, 'IB.calcPayroll(...)', 'hardcoded rate in a view'));
  });
}

/* ═══════════════════ 4. I18N ═══════════════════ */
console.log(bold('\nI18N — both languages complete'));
{
  ['da', 'nb'].forEach(lang => {
    const missing = I.missing(lang);
    if (!missing.length) ok(`${lang} complete`, `${Object.keys(I.STRINGS[lang]).length} keys`);
    else fail(`${lang} is missing ${missing.length} keys`, 'complete', missing.slice(0, 8).join(', '));
  });

  const known = new Set(I.allKeys());
  const used = new Set();
  ['invoicery-business.html', 'invoicery-business-admin.html'].forEach(f => {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/\bt\('([^']+)'\)/g)) used.add(m[1]);
    for (const m of s.matchAll(/data-i18n(?:-html|-placeholder|-title)?="([^"]+)"/g)) used.add(m[1]);
  });
  // Keys built at runtime from a prefix.
  Object.values(IB.STATUS).forEach(s => used.add('status.' + s));
  ['c.dash','c.new','c.list','c.pay','c.cert','c.profile',
   'b.dash','b.approve','b.all','b.invoices','b.profile',
   'a.dash','a.activity','a.approve','a.all','a.consultants','a.companies',
   'a.payroll','a.invoices','a.services','a.settings']
    .forEach(v => { used.add('title.' + v); used.add('sub.' + v); });

  const unknown = [...used].filter(k => !known.has(k)).sort();
  if (!unknown.length) ok('every referenced key exists', `${used.size} referenced`);
  else unknown.forEach(k => fail(`unknown key referenced: ${k}`, 'a defined key', 'missing'));

  // No Swedish left over — the markets we serve are DK and NO.
  const swedish = /\b(uppdrag|konsult|företag|lönekörning|arbetsgivaravgift|väntar_godkännande|godkänt|utbetalt|avvisat|timlön|belopp|Logga in|Översikt)\b/;
  let leftovers = 0;
  ['invoicery-business.html', 'invoicery-business-admin.html'].forEach(f => {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (swedish.test(line)) { leftovers++; if (leftovers <= 5) fail(`${f}:${i + 1} — Swedish text remains`, 'da/nb only', line.trim().slice(0, 70)); }
    });
  });
  if (!leftovers) ok('no Swedish strings remain in either app');
}

/* ═══════════════════ 5. IDENTIFIERS ═══════════════════ */
console.log(bold('\nIDENTIFIERS — no confusable homoglyphs'));
{
  const confusable = /[Ѐ-ӿͰ-Ͽ]/;
  const files = ['invoicery-business.html', 'invoicery-business-admin.html',
                 'ib-core.js', 'ib-markets.js', 'ib-i18n.js'];
  let clean = true;
  files.forEach(f => {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) return;
    fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (confusable.test(line)) {
        clean = false;
        const chars = [...new Set([...line].filter(c => confusable.test(c)))]
          .map(c => `${c} (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
        fail(`${f}:${i + 1} — confusable character`, 'ASCII or Nordic letters', chars.join(', '));
      }
    });
  });
  if (clean) ok('no Cyrillic or Greek homoglyphs in source');
}

console.log('');
if (failures === 0) { console.log(green(bold(`  ${checks} checks passed.`))); process.exit(0); }
console.log(red(bold(`  ${failures} of ${checks} checks FAILED.`)));
process.exit(1);
