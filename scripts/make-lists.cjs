#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   make-lists.cjs — generate employee and payout lists

     node scripts/make-lists.cjs [options]

   Options
     --market DK|NO       which market's data and legal entity   (default: both)
     --profile <name>     general | ff-no | ff-dk | payroll      (default: general)
     --kind employees|payouts|both                               (default: both)
     --out <dir>          output directory                       (default: ./out)
     --csv                also write .csv alongside .xlsx
     --redact             omit identity numbers and bank details
     --status a,b         payout statuses to include   (default: approved,paid)
     --period "April 2026"
     --level payroll      check completeness against payroll requirements
     --list-profiles      print the available profiles and exit

   Exits non-zero if any row is missing a required field, so this can gate a
   handover: you find out here rather than when the target system rejects it.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

require(path.join(ROOT, 'ib-markets.js'));
require(path.join(ROOT, 'ib-i18n.js'));
const IB = require(path.join(ROOT, 'ib-core.js'));
const W  = require(path.join(ROOT, 'ib-xlsx-write.js'));
const L  = require(path.join(ROOT, 'ib-lists.js'));

const green = s => `\x1b[32m${s}\x1b[0m`;
const amber = s => `\x1b[33m${s}\x1b[0m`;
const red   = s => `\x1b[31m${s}\x1b[0m`;
const dim   = s => `\x1b[2m${s}\x1b[0m`;
const bold  = s => `\x1b[1m${s}\x1b[0m`;

/* ── args ── */
const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf('--' + name);
  return i === -1 ? fallback : (argv[i + 1] || '').replace(/^--/, '') || fallback;
}
const flag = name => argv.includes('--' + name);

if (flag('list-profiles')) {
  console.log(bold('\nProfiles\n'));
  Object.keys(L.PROFILES).forEach(k => {
    const p = L.PROFILES[k];
    console.log('  ' + bold(k.padEnd(10)) + p.label);
    console.log(dim('    employee: ' + p.employee.columns.length + ' columns' +
                (p.employee.banner ? ' · banner "' + p.employee.banner + '"' : '')));
    console.log(dim('    payout:   ' + p.payout.columns.length + ' columns' +
                (p.payout.banner ? ' · banner "' + p.payout.banner + '"' : '')));
  });
  console.log('');
  process.exit(0);
}

const markets  = opt('market', '') ? [opt('market', '').toUpperCase()] : ['DK', 'NO'];
const profile  = opt('profile', 'general');
const kind     = opt('kind', 'both');
const outDir   = path.resolve(ROOT, opt('out', 'out'));
const level    = opt('level', 'always');
const statuses = opt('status', 'approved,paid').split(',').map(s => s.trim()).filter(Boolean);
const period   = opt('period', '');
const redact   = flag('redact');
const alsoCsv  = flag('csv');

if (!L.PROFILES[profile]) {
  console.error(red(`\n  Unknown profile "${profile}". Try --list-profiles.\n`));
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });
IB.seedAll();

let blockers = 0, written = 0;

function write(list, kindName, market) {
  const base = L.fileName(kindName, profile, market);
  const xlsx = path.join(outDir, base + '.xlsx');
  fs.writeFileSync(xlsx, W.build(L.toSheetSpec(list)));
  written++;
  console.log('  ' + green('wrote') + ' ' + path.relative(ROOT, xlsx) +
              dim(`  ${list.rows.length} rows × ${list.columns.length} cols`));
  if (alsoCsv) {
    const csv = path.join(outDir, base + '.csv');
    fs.writeFileSync(csv, L.toCSV(list, market), 'utf8');
    written++;
    console.log('  ' + green('wrote') + ' ' + path.relative(ROOT, csv));
  }
  if (list.issues.length) {
    blockers += list.issues.length;
    console.log('  ' + amber(`${list.issues.length} row(s) missing required fields:`));
    list.issues.slice(0, 10).forEach(i =>
      console.log(dim(`      ${i.name || '(row ' + (i.index + 1) + ')'} → ${i.missing.join(', ')}`)));
    if (list.issues.length > 10) console.log(dim(`      …and ${list.issues.length - 10} more`));
  }
}

console.log(bold(`\nProfile: ${profile}  ${dim(L.PROFILES[profile].label)}`));
if (redact) console.log(amber('  Redacted: identity numbers and bank details omitted.'));

markets.forEach(code => {
  if (!IB.setMarket(code)) {
    console.error(red(`  Unknown market "${code}"`));
    process.exitCode = 2;
    return;
  }
  const m = IB.market();
  console.log('\n' + bold(`${m.flag} ${m.name}`) + dim(`  ${m.entity.legalName} · ${m.currency}`));

  if (kind === 'employees' || kind === 'both') {
    const recs = L.employeesFromStore();
    write(L.buildEmployeeList(recs, { profile, includeSensitive: !redact, level }),
          'employees', m);
  }
  if (kind === 'payouts' || kind === 'both') {
    const recs = L.payoutsFromStore({ statuses, period: period || undefined });
    write(L.buildPayoutList(recs, { profile, includeSensitive: !redact }), 'payouts', m);
  }
});

console.log('');
if (blockers) {
  console.log(amber(bold(`  ${written} file(s) written, but ${blockers} row(s) are missing ` +
                         `required fields — see above before handing these over.`)));
  process.exit(1);
}
console.log(green(bold(`  ${written} file(s) written to ${path.relative(ROOT, outDir)}/`)));
