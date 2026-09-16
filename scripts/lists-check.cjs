#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   lists-check.cjs — employee/payout list generation and .xlsx writing

     1. WRITER     The zero-dependency .xlsx writer produces a file our own
                   reader round-trips, with typing preserved: identity
                   numbers and postal codes stay text (leading zeros), money
                   stays numeric.
     2. SCHEMA     Canonical fields are complete and internally consistent.
     3. PROFILES   Every profile resolves; ff-no/ff-dk reproduce the supplied
                   Frilans Finans templates column for column.
     4. MAPPING    Stored consultants and assignments lift into canonical
                   records without inventing data.
     5. GAPS       The completeness check names exactly what blocks a
                   registration, at both levels.
     6. PII        includeSensitive:false removes every sensitive column and
                   nothing else.
     7. BANNER     A template's title row does not get mistaken for headers
                   on the way back in.

   Exit 0 = clean.
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
const R  = require(path.join(ROOT, 'ib-xlsx.js'));
const W  = require(path.join(ROOT, 'ib-xlsx-write.js'));
const L  = require(path.join(ROOT, 'ib-lists.js'));

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
function eq(l, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) ok(l, a.length < 66 ? a : undefined); else fail(l, e, a);
}

/* The columns of the supplied Frilans Finans Norway templates, verbatim. */
const FF_EMPLOYEE = ['First name','Surname','Street Address','ZIP code','Area','Country',
                     'E-mail','Phone number','Personal ID',
                     'Bank account holder if in other name','Bank account'];
const FF_PAYOUT   = ['Name','Invoice amount excl. VAT','Dates and hours'];

(async () => {

  /* ═══════════════════ 1. WRITER ═══════════════════ */
  console.log(bold('\nWRITER — .xlsx round-trips through our own reader'));
  {
    const bytes = W.build({
      sheet: 'Personal data', title: 'Personal data',
      columns: [
        { header: 'First name', width: 18 },
        { header: 'Personal ID', width: 18, type: 'text' },
        { header: 'ZIP code', width: 10, type: 'text' },
        { header: 'Amount', width: 14, type: 'number' },
        { header: 'Odd', width: 30 }
      ],
      rows: [
        ['Sara', '15039099999', '0184', 31600, 'æ ø å "q" & <t>'],
        ['Erik', '22078599999', '5003', 16320, '']
      ]
    });
    eq('produces a ZIP', [bytes[0], bytes[1]], [0x50, 0x4b]);

    const t = await R.readTable({ name: 'x.xlsx', bytes });
    eq('sheet name survives', t.sheet, 'Personal data');
    eq('banner detected, not read as header', t.banner, 'Personal data');
    eq('headers', t.headers, ['First name','Personal ID','ZIP code','Amount','Odd']);
    eq('identity number stays text, leading zero intact', t.rows[0].cells[1], '15039099999');
    eq('postal code keeps its leading zero', t.rows[0].cells[2], '0184');
    eq('money stays numeric', t.rows[0].cells[3], 31600);
    eq('nordic + xml-special characters intact', t.rows[0].cells[4], 'æ ø å "q" & <t>');
    eq('data starts on the line Excel shows', t.rows[0].line, 3);

    // an empty sheet is still a valid file
    const empty = W.build({ sheet: 'Empty', columns: [{ header: 'A' }], rows: [] });
    const te = await R.readTable({ name: 'e.xlsx', bytes: empty });
    eq('header-only file reads back', te.headers, ['A']);
    eq('and has no data rows', te.rows.length, 0);

    // CRC32 against a known vector
    eq('crc32("123456789")', W.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
    eq('column naming past Z', [W.colName(0), W.colName(25), W.colName(26), W.colName(51)],
       ['A','Z','AA','AZ']);
  }

  /* ═══════════════════ 2. SCHEMA ═══════════════════ */
  console.log(bold('\nSCHEMA — canonical fields'));
  {
    const noHeader = L.EMPLOYEE_FIELDS.filter(f => !f.header).map(f => f.key)
      .concat(L.PAYOUT_FIELDS.filter(f => !f.header).map(f => f.key));
    eq('every field has a canonical header', noHeader, []);

    const dupE = L.EMPLOYEE_FIELDS.map(f => f.key).filter((k, i, a) => a.indexOf(k) !== i);
    const dupP = L.PAYOUT_FIELDS.map(f => f.key).filter((k, i, a) => a.indexOf(k) !== i);
    eq('no duplicate employee keys', dupE, []);
    eq('no duplicate payout keys', dupP, []);

    const badReq = L.EMPLOYEE_FIELDS.concat(L.PAYOUT_FIELDS)
      .filter(f => [false, 'always', 'payroll'].indexOf(f.required) === -1).map(f => f.key);
    eq('required flags are valid', badReq, []);

    /* Identity numbers, postal codes and bank accounts must never be typed
       as numbers — Excel would eat leading zeros and mangle long digits. */
    const mistyped = L.EMPLOYEE_FIELDS
      .filter(f => ['personalId','zip','bankAccount','phone','employeeNumber','costCentre'].includes(f.key))
      .filter(f => f.type !== 'text').map(f => f.key);
    eq('digit-strings are typed text, not number', mistyped, []);

    eq('sensitive fields are flagged',
       L.EMPLOYEE_FIELDS.filter(f => f.sensitive).map(f => f.key).sort(),
       ['bankAccount','bankAccountHolder','personalId']);
  }

  /* ═══════════════════ 3. PROFILES ═══════════════════ */
  console.log(bold('\nPROFILES — resolve, and match the supplied templates'));
  {
    const names = Object.keys(L.PROFILES);
    eq('profiles present', names, ['general','ff-no','ff-dk','payroll']);

    names.forEach(n => {
      const e = L.buildEmployeeList([], { profile: n });
      const p = L.buildPayoutList([], { profile: n });
      if (e.columns.length && p.columns.length) ok(`${n} resolves`, `${e.columns.length}+${p.columns.length} cols`);
      else fail(`${n} resolves`, 'columns on both lists', `${e.columns.length}/${p.columns.length}`);
    });

    const ffe = L.buildEmployeeList([], { profile: 'ff-no' });
    eq('ff-no employee columns match the template exactly',
       ffe.columns.map(c => c.header), FF_EMPLOYEE);
    eq('ff-no employee banner', ffe.title, 'Personal data');

    const ffp = L.buildPayoutList([], { profile: 'ff-no' });
    eq('ff-no payout columns match the template exactly',
       ffp.columns.map(c => c.header), FF_PAYOUT);
    eq('ff-no payout banner', ffp.title, 'Payouts Registration');

    eq('ff-dk mirrors the same column count',
       L.buildEmployeeList([], { profile: 'ff-dk' }).columns.length, FF_EMPLOYEE.length);

    // general must expose every canonical field
    eq('general employee exposes all fields',
       L.buildEmployeeList([], { profile: 'general' }).columns.length, L.EMPLOYEE_FIELDS.length);
    eq('general payout exposes all fields',
       L.buildPayoutList([], { profile: 'general' }).columns.length, L.PAYOUT_FIELDS.length);

    let threw = false;
    try { L.buildEmployeeList([], { profile: 'nope' }); } catch (e) { threw = /UNKNOWN_PROFILE/.test(e.message); }
    eq('unknown profile is rejected, not silently defaulted', threw, true);
  }

  /* The composed FF "Dates and hours" cell. */
  console.log(bold('\nCOMPOSE — FF collapses dates and hours into one cell'));
  {
    eq('range + hours', L.composeDatesAndHours({ dateFrom: '2026-04-01', dateTo: '2026-04-30', hours: 37.5 }),
       '2026-04-01–2026-04-30, 37.5 t');
    eq('single day is not shown as a range',
       L.composeDatesAndHours({ dateFrom: '2026-04-01', dateTo: '2026-04-01', hours: 8 }),
       '2026-04-01, 8 t');
    eq('falls back to period when dates are absent',
       L.composeDatesAndHours({ period: 'April 2026', hours: 12 }), 'April 2026, 12 t');
    eq('empty record yields an empty cell, not "undefined"',
       L.composeDatesAndHours({}), '');
    eq('zero hours is still reported', L.composeDatesAndHours({ dateFrom: '2026-04-01', hours: 0 }),
       '2026-04-01, 0 t');
  }

  /* ═══════════════════ 4. MAPPING ═══════════════════ */
  console.log(bold('\nMAPPING — stored records lift into canonical shape'));
  {
    IB.seedAll();
    for (const code of ['DK', 'NO']) {
      IB.setMarket(code);
      const emps = L.employeesFromStore();
      eq(`${code}: consultants only`, emps.length, 2);
      const sara = emps.find(e => e.firstName === 'Sara');
      eq(`${code}: name split into first/last`, [sara.firstName, sara.lastName], ['Sara','Bergström']);
      if (sara.personalId && sara.zip && sara.street) ok(`${code}: identity and address mapped`,
        `${sara.personalId} · ${sara.zip} ${sara.city}`);
      else fail(`${code}: identity and address mapped`, 'populated', JSON.stringify(sara).slice(0, 80));
      eq(`${code}: country defaults to the market`, sara.country, code === 'DK' ? 'Danmark' : 'Norge');
    }

    // unknown fields stay blank rather than being invented
    const bare = L.employeeFromUser({ id: 'X', name: 'Ola Nordmann', email: 'o@n.no' },
                                    { name: 'Norge' });
    eq('absent tax card is blank, not guessed', bare.taxCard, '');
    eq('absent bank account is blank, not guessed', bare.bankAccount, '');
    eq('single-word name leaves surname empty',
       [L.employeeFromUser({ name: 'Madonna' }, { name: 'Norge' }).firstName,
        L.employeeFromUser({ name: 'Madonna' }, { name: 'Norge' }).lastName], ['Madonna','']);
    eq('three-part name keeps the tail together',
       L.employeeFromUser({ name: 'Ola Kari Nordmann' }, { name: 'Norge' }).lastName, 'Kari Nordmann');

    IB.setMarket('NO');
    const pays = L.payoutsFromStore({ statuses: [IB.STATUS.APPROVED, IB.STATUS.PAID] });
    if (pays.length) ok('payouts filtered by status', `${pays.length} rows`);
    else fail('payouts filtered by status', '>0', '0');
    eq('payout carries a machine-usable reference', typeof pays[0].employeeRef, 'string');
    eq('amount is numeric', typeof pays[0].invoiceAmount, 'number');
    eq('period filter narrows', L.payoutsFromStore({ period: 'Mars 2026' }).length,
       IB.getAssignments().filter(a => a.period === 'Mars 2026').length);
  }

  /* ═══════════════════ 5. GAPS ═══════════════════ */
  console.log(bold('\nGAPS — what blocks a registration'));
  {
    const incomplete = { firstName: 'Ola', lastName: 'Nordmann', email: '', personalId: '',
                         street: 'Gata 1', zip: '', city: 'Oslo', country: 'Norge' };
    eq('registration level names the missing required fields',
       L.checkEmployee(incomplete, 'always').sort(), ['email','personalId','zip']);
    eq('payroll level additionally demands payroll fields',
       L.checkEmployee(incomplete, 'payroll').sort(),
       ['bankAccount','email','employmentType','personalId','startDate','taxCard','zip']);

    const complete = { firstName: 'Ola', lastName: 'Nordmann', personalId: '01019099999',
                       email: 'o@n.no', street: 'Gata 1', zip: '0150', city: 'Oslo',
                       country: 'Norge' };
    eq('a complete record reports nothing', L.checkEmployee(complete, 'always'), []);

    const built = L.buildEmployeeList([incomplete, complete], { profile: 'general' });
    eq('issues are reported per person, indexed', built.issues.map(i => i.index), [0]);
    eq('and name the person', built.issues[0].name, 'Ola Nordmann');
    eq('rows are still produced for incomplete people', built.rows.length, 2);

    eq('payout gaps', L.checkPayout({ name: 'X', invoiceAmount: 10 }).sort(),
       ['dateFrom','dateTo','hours']);
  }

  /* ═══════════════════ 6. PII ═══════════════════ */
  console.log(bold('\nPII — a redacted copy can be produced'));
  {
    IB.setMarket('NO');
    const emps = L.employeesFromStore();
    const full = L.buildEmployeeList(emps, { profile: 'general' });
    const safe = L.buildEmployeeList(emps, { profile: 'general', includeSensitive: false });

    eq('sensitive columns removed', full.columns.length - safe.columns.length, 3);
    eq('and only those', safe.columns.filter(c => c.sensitive).length, 0);
    const headers = safe.columns.map(c => c.header);
    eq('no identity number column', headers.includes('Personal ID'), false);
    eq('no bank account column', headers.includes('Bank account'), false);
    eq('non-sensitive columns untouched', headers.includes('E-mail'), true);
    eq('row width follows the column count', safe.rows[0].length, safe.columns.length);

    const ffSafe = L.buildEmployeeList(emps, { profile: 'ff-no', includeSensitive: false });
    eq('redaction applies to a system profile too',
       ffSafe.columns.length, FF_EMPLOYEE.length - 3);
  }

  /* ═══════════════════ 7. END TO END ═══════════════════ */
  console.log(bold('\nEND TO END — generate, write, read back'));
  {
    for (const [code, profile] of [['NO','ff-no'], ['DK','ff-dk'], ['NO','payroll']]) {
      IB.setMarket(code);
      const list = L.buildEmployeeList(L.employeesFromStore(), { profile });
      const bytes = W.build(L.toSheetSpec(list));
      const back = await R.readTable({ name: 'x.xlsx', bytes });
      const expect = list.columns.map(c => c.header);
      if (JSON.stringify(back.headers) === JSON.stringify(expect) &&
          back.rows.length === list.rows.length) {
        ok(`${code}/${profile} survives write→read`, `${back.rows.length} people, ${expect.length} cols`);
      } else {
        fail(`${code}/${profile} survives write→read`,
             JSON.stringify(expect), JSON.stringify(back.headers));
      }
      // identity numbers must not have become numbers in transit
      const idCol = expect.findIndex(h => /Personal ID/.test(h));
      if (idCol >= 0 && back.rows.length) {
        const v = back.rows[0].cells[idCol];
        if (typeof v === 'string') ok(`${code}/${profile} identity number still text`, v);
        else fail(`${code}/${profile} identity number still text`, 'string', typeof v + ' ' + v);
      }
    }

    IB.setMarket('NO');
    const pl = L.buildPayoutList(L.payoutsFromStore({ statuses: [IB.STATUS.PAID] }), { profile: 'ff-no' });
    const csv = L.toCSV(pl);
    eq('CSV carries a BOM for Excel', csv.charCodeAt(0), 0xfeff);
    eq('CSV is semicolon-separated', csv.split('\r\n')[1].includes(';'), true);
    eq('CSV banner precedes the header row',
       csv.split('\r\n')[0].replace(/^﻿/, ''), 'Payouts Registration');
    eq('CSV uses a decimal comma in nb-NO', /\d+,\d/.test(csv) || !/\d+\.\d/.test(csv), true);

    eq('file name carries kind, profile, market and date',
       /^employees-ff-no-no-\d{8}$/.test(L.fileName('employees', 'ff-no')), true);
  }

  console.log('');
  if (failures === 0) { console.log(green(bold(`  ${checks} checks passed.`))); process.exit(0); }
  console.log(red(bold(`  ${failures} of ${checks} checks FAILED.`)));
  process.exit(1);

})().catch(e => {
  console.error(red('\n  Harness error: ' + e.message));
  console.error(e.stack);
  process.exit(1);
});
