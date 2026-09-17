#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   staff-check.cjs — personnel register import and the Dataløn handover

     1. MAPPING    Danish, Norwegian and English headers land on the right
                   canonical field; unknown columns are ignored, not fatal.
     2. VALIDATION Pure. Two levels: `always` blocks registration, `payroll`
                   only blocks being paid. Line numbers are the file's own.
     3. DUPLICATES Against the existing register and within the file, on
                   either identity key, insensitive to CPR punctuation.
     4. COMMIT     Error rows are skipped, never coerced. No logins created.
     5. DATALØN    The batch assembles, the CSV round-trips through our own
                   reader, and sendToDatalon() refuses while unverified.
     6. PII        A personal ID that reached the register is never widened
                   beyond it by the export.
     7. CSV        A real .csv file parses through IBXlsx with the delimiter
                   and BOM Danish and Norwegian Excel writes.

   Exit 0 = clean.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

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
require(path.join(ROOT, 'ib-lists.js'));
const S  = require(path.join(ROOT, 'ib-staff.js'));

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
function truthy(l, v, d) { if (v) ok(l, d); else fail(l, 'truthy', JSON.stringify(v)); }

const DK_HEADERS = ['Fornavn', 'Efternavn', 'CPR-nummer', 'E-mail', 'Telefon',
                    'Adresse', 'Postnummer', 'By', 'Land', 'Bankkonto',
                    'Startdato', 'Ansættelsestype', 'Skattekort', 'Trækprocent'];

function row(line, cells) { return { line, cells }; }

const FULL_DK = ['Sara', 'Bergström', '150390-9999', 'sara@konsulent.dk', '+45 20 12 34 56',
                 'Nørrebrogade 42', '2200', 'København', 'Danmark', '1234-0009999999',
                 '2026-01-01', 'hourly', 'hovedkort', '38'];

(async () => {

  /* ═══════════════════ 1. MAPPING ═══════════════════ */
  console.log(bold('\nMAPPING — headers land on canonical fields'));
  {
    const m = S.mapColumns(DK_HEADERS);
    eq('Danish headers, nothing missing', m.missing, []);
    eq('every Danish header consumed', m.unknown, []);

    const nb = S.mapColumns(['Fornavn', 'Etternavn', 'Fødselsnummer', 'E-post',
                             'Gateadresse', 'Postnummer', 'Poststed', 'Land']);
    eq('Norwegian headers, nothing missing', nb.missing, []);

    const en = S.mapColumns(['First name', 'Surname', 'Personal ID', 'Email',
                             'Street address', 'ZIP code', 'City', 'Country']);
    eq('English headers, nothing missing', en.missing, []);

    /* An HR export carries columns we have no use for. That is not an error. */
    const extra = S.mapColumns(DK_HEADERS.concat(['Projektkode', 'Intern note']));
    eq('unknown columns reported, not fatal', extra.unknown, ['Projektkode', 'Intern note']);
    eq('unknown columns do not break mapping', extra.missing, []);

    const short = S.mapColumns(['Fornavn', 'E-mail']);
    truthy('a file missing required columns says which',
           short.missing.includes('lastName') && short.missing.includes('personalId'),
           short.missing.join(', '));

    /* Case, punctuation and doubled spaces must not matter. */
    const messy = S.mapColumns(['  FORNAVN ', 'efternavn', 'CPR_nummer', 'E.MAIL',
                                'Adresse', 'Post nr', 'By', 'Land']);
    eq('headers normalise before matching', messy.missing, []);
  }

  /* ═══════════════════ 2. VALIDATION ═══════════════════ */
  console.log(bold('\nVALIDATION — pure, two levels, real line numbers'));
  {
    const m = S.mapColumns(DK_HEADERS).mapping;
    const before = JSON.stringify(store);
    const v = S.validate({ rows: [
      row(2, FULL_DK),
      row(3, ['Erik', 'Johansen', '220785-9999', 'erik@konsulent.dk', '',
              'Banegårdspladsen 7', '8000', 'Aarhus', 'Danmark', '', '', '', '', '']),
      row(4, ['', '', '', '', '', '', '', '', '', '', '', '', '', '']),
      row(9, ['Mads', '', '', 'ikke-en-mail', '', 'Vej 2', '1000', 'Kbh', 'Danmark',
              '', '', '', '', ''])
    ] }, m, { existing: [] });

    eq('validate() wrote nothing', JSON.stringify(store), before);
    eq('verdict counts', v.counts, { ok: 1, warning: 1, error: 1, blank: 1 });

    const complete = v.results.find(r => r.line === 2);
    eq('a complete row is ok', complete.verdict, 'ok');

    /* Registrable but not payable: exactly the distinction ib-lists.js draws. */
    const partial = v.results.find(r => r.line === 3);
    eq('missing payroll fields warn, not error', partial.verdict, 'warning');
    truthy('the warning names the payroll gaps',
           partial.warnings.some(w => w.field === 'taxCard') &&
           partial.warnings.some(w => w.field === 'bankAccount'),
           partial.warnings.map(w => w.field).join(', '));

    const broken = v.results.find(r => r.line === 9);
    eq('missing identity blocks registration', broken.verdict, 'error');
    truthy('a malformed e-mail is caught',
           broken.errors.some(e => e.field === 'email' && e.code === 'format'));

    /* Line 9 is line 9 when the file is opened, not "row 4 after blanks". */
    eq('line numbers come from the file', v.results.map(r => r.line), [2, 3, 4, 9]);
    eq('blank rows are neither imported nor errors',
       v.results.find(r => r.line === 4).verdict, 'blank');
  }

  /* ═══════════════════ 3. DUPLICATES ═══════════════════ */
  console.log(bold('\nDUPLICATES — against the register and within the file'));
  {
    const m = S.mapColumns(DK_HEADERS).mapping;

    /* Same person, CPR written without its hyphen. */
    const dupInFile = S.validate({ rows: [
      row(2, FULL_DK),
      row(3, FULL_DK.map((c, i) => i === 2 ? '1503909999' : (i === 3 ? 'anden@k.dk' : c)))
    ] }, m, { existing: [] });
    eq('punctuation does not hide a duplicate', dupInFile.counts.error, 1);
    truthy('and it is reported as one',
           dupInFile.results[1].errors.some(e => e.code === 'duplicateInFile'));

    /* Re-importing the same file must flag, not double up. */
    const first = S.commit(S.validate({ rows: [row(2, FULL_DK)] }, m, { existing: [] }), {});
    const again = S.validate({ rows: [row(2, FULL_DK)] }, m, { existing: first });
    eq('re-importing flags every row as a duplicate', again.counts.error, 1);
    eq('and imports nothing', again.importable.length, 0);

    const byEmail = S.validate({ rows: [
      row(2, FULL_DK.map((c, i) => i === 2 ? '010101-0001' : c))
    ] }, m, { existing: first });
    truthy('a repeat e-mail is a duplicate too',
           byEmail.results[0].errors.some(e => e.field === 'email' && e.code === 'duplicate'));
  }

  /* ═══════════════════ 4. COMMIT ═══════════════════ */
  console.log(bold('\nCOMMIT — error rows skipped, never coerced'));
  {
    const m = S.mapColumns(DK_HEADERS).mapping;
    const v = S.validate({ rows: [
      row(2, FULL_DK),
      row(3, ['Erik', 'Johansen', '220785-9999', 'erik@konsulent.dk', '',
              'Banegårdspladsen 7', '8000', 'Aarhus', 'Danmark', '', '', '', '', '']),
      row(4, ['Mads', '', '', 'x', '', '', '', '', '', '', '', '', '', ''])
    ] }, m, { existing: [] });

    const recs = S.commit(v, { now: '2026-09-17' });
    eq('only ok and warning rows commit', recs.length, 2);
    eq('the error row is absent',
       recs.some(r => r.firstName === 'Mads'), false);
    eq('nothing was invented for the warning row', recs[1].taxCard, '');
    eq('commit stamps the import date', recs[0].importedAt, '2026-09-17');
    eq('and keeps the source line', recs.map(r => r.sourceLine), [2, 3]);
    eq('every committed record starts pending at Dataløn',
       recs.every(r => r.datalonStatus === 'pending'), true);

    /* These people have no login, and an upload does not grant one. */
    eq('commit creates no credentials',
       recs.some(r => 'password' in r || 'role' in r), false);
  }

  /* ═══════════════════ 5. DATALØN ═══════════════════ */
  console.log(bold('\nDATALØN — assembles, refuses to send while unverified'));
  {
    const m = S.mapColumns(DK_HEADERS).mapping;
    const recs = S.commit(S.validate({ rows: [row(2, FULL_DK)] }, m, { existing: [] }), {});

    const batch = S.toDatalon(recs, { market: 'DK', now: '2026-09-17' });
    eq('the batch carries its row count', batch.count, 1);
    eq('the batch is marked unverified', batch.verified, false);

    const r0 = batch.rows[0];
    eq('employment type maps to a Dataløn code', r0.employmentCode, 'H');
    eq('tax card maps to a Dataløn code', r0.taxCardCode, '1');
    eq('the personal ID is carried verbatim', r0.personalId, '150390-9999');

    const sent = S.sendToDatalon(recs, { market: 'DK' });
    eq('sendToDatalon refuses', sent.sent, false);
    eq('and says why', sent.reason, 'NOT_IMPLEMENTED');
    truthy('the unverified config is the stated problem',
           sent.problems.includes('CONFIG_UNVERIFIED'), sent.problems.join(', '));

    /* The guard has to bite on real gaps, not only on the config flag. */
    const nameless = S.sendToDatalon([{ personalId: '', lastName: '' }], {});
    truthy('a row with no identity is caught',
           nameless.problems.some(p => /NO_PERSONAL_ID/.test(p)) &&
           nameless.problems.some(p => /NO_NAME/.test(p)),
           nameless.problems.join(', '));

    eq('an empty batch is refused', S.sendToDatalon([], {}).problems.includes('EMPTY_BATCH'), true);

    /* If this ever passes, the placeholders were shipped as if real. */
    eq('DATALON_CONFIG is still flagged unverified', S.DATALON_CONFIG.verified, false);
  }

  /* ═══════════════════ 6. PII ═══════════════════ */
  console.log(bold('\nPII — nothing widens beyond the register'));
  {
    const m = S.mapColumns(DK_HEADERS).mapping;
    const v = S.validate({ rows: [row(2, FULL_DK)] }, m, { existing: [] });

    /* A validation result is what the preview renders. It must describe the
       problem, not repeat the identity number into a message. */
    const blob = JSON.stringify(v.results.map(r => ({ errors: r.errors, warnings: r.warnings })));
    eq('verdicts carry field names, not values', /150390/.test(blob), false);

    const sent = S.sendToDatalon([{ personalId: '150390-9999', lastName: '' }], {});
    eq('the refusal reason carries no identity number',
       /150390/.test(sent.reason + sent.detail + sent.problems.join('')), false);
  }

  /* ═══════════════════ 7. CSV ═══════════════════ */
  console.log(bold('\nCSV — a real file, through our own reader'));
  {
    /* The template is what an admin downloads, fills in and uploads back.
       It has to survive that round trip or the whole feature is theatre. */
    for (const lang of ['da', 'nb']) {
      const text = S.templateCSV(lang);
      const bytes = Buffer.from(text, 'utf8');
      const table = await R.readTable({ name: 'template.csv', bytes: new Uint8Array(bytes) });
      const m = S.mapColumns(table.headers);
      eq(`${lang}: the template maps with nothing missing`, m.missing, []);
      eq(`${lang}: and nothing unrecognised`, m.unknown, []);

      const v = S.validate(table, m.mapping, { existing: [] });
      eq(`${lang}: the template's example row is importable`, v.counts.error, 0);
    }

    /* The Dataløn export is semicolon-separated and BOM-prefixed so Danish
       and Norwegian Excel opens it without an import dialog. */
    const m = S.mapColumns(DK_HEADERS).mapping;
    const recs = S.commit(S.validate({ rows: [row(2, FULL_DK)] }, m, { existing: [] }), {});
    const csv = S.toDatalonCSV(recs, { market: 'DK' });
    eq('the export is BOM-prefixed', csv.charCodeAt(0), 0xfeff);
    truthy('and semicolon-separated', csv.split('\r\n')[0].split(';').length > 10);

    const back = await R.readTable({
      name: 'datalon.csv', bytes: new Uint8Array(Buffer.from(csv, 'utf8'))
    });
    truthy('the export reads back through our own reader',
           back.rows.length === 1, back.headers.length + ' columns');

    /* Excel eats leading zeros and turns long digit strings into scientific
       notation. The CPR number has to come back as it went in. */
    const idCol = back.headers.indexOf('personalId');
    eq('the identity number survives the round trip',
       String(back.rows[0].cells[idCol]), '150390-9999');
  }

  /* ═══════════════════ STORAGE ═══════════════════ */
  console.log(bold('\nSTORAGE — per market, cleared by a demo reset'));
  {
    IB.setMarket('DK'); IB.saveStaff([{ firstName: 'DK person' }]);
    IB.setMarket('NO');
    eq('the register does not cross markets', IB.getStaff(), []);
    IB.setMarket('DK');
    eq('and is there in its own', IB.getStaff().length, 1);
    IB.resetDemo('DK');
    eq('a demo reset clears it', IB.getStaff(), []);
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
