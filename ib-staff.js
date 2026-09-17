/* ═══════════════════════════════════════════════════════════════════════════
   ib-staff.js — personnel register import

   A superadmin uploads a CSV of personnel; the rows are mapped onto the
   canonical employee schema in ib-lists.js, validated, and handed over to
   Dataløn so the employee profiles are created there.

   This is NOT ib-import.js. That module imports a payroll BASIS — hours and
   rates for people who already exist. This one imports the PEOPLE. Same
   machinery, different schema, different destination, so they stay apart.

   Reading is delegated to IBXlsx.readTable, which already handles CSV with
   either delimiter, a BOM, and quoted fields. validate() is pure and writes
   nothing; commit() is the only thing that stores.

   > The Dataløn field mapping is UNVERIFIED. Column names, the employee
   > number series and the employment-type codes in DATALON_CONFIG are
   > placeholders, and the admin UI says so. sendToDatalon() deliberately
   > refuses to send: inventing an endpoint contract would be worse than not
   > having one. Same position as JEEVES_CONFIG in ib-import.js.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var Lists = global.IBLists ||
    (typeof require !== 'undefined' ? require('./ib-lists.js') : null);

  var LIMITS = { maxRows: 5000, maxBytes: 8 * 1024 * 1024 };

  /* ═══════════════════ COLUMNS ═══════════════════
     Every canonical employee field a personnel export plausibly carries,
     with the Danish, Norwegian and English headers it arrives under. The
     aliases are matched normalised, so case, punctuation and doubled spaces
     do not matter. Unknown columns are not an error — an HR export carries
     plenty we have no use for. */
  var COLUMNS = {
    firstName: { required: true, aliases: [
      'fornavn', 'förnamn', 'first name', 'firstname', 'given name'] },
    lastName: { required: true, aliases: [
      'efternavn', 'etternavn', 'efternamn', 'surname', 'last name', 'lastname',
      'family name'] },
    personalId: { required: true, aliases: [
      'cpr-nummer', 'cpr nummer', 'cpr', 'cpr-nr', 'fødselsnummer',
      'fodselsnummer', 'personnummer', 'person id', 'personal id',
      'national id', 'personnr'] },
    dateOfBirth: { aliases: [
      'fødselsdato', 'fodselsdato', 'fødselsdag', 'birth date', 'date of birth',
      'født', 'fodt'] },

    email: { required: true, aliases: [
      'e-mail', 'email', 'e-post', 'epost', 'mail', 'e-mailadresse',
      'e-postadresse'] },
    phone: { aliases: [
      'telefon', 'telefonnummer', 'mobil', 'mobilnummer', 'phone',
      'phone number', 'tlf'] },
    street: { required: true, aliases: [
      'adresse', 'gade', 'gate', 'gateadresse', 'vejnavn', 'street',
      'street address', 'address'] },
    zip: { required: true, aliases: [
      'postnummer', 'postnr', 'post nr', 'zip', 'zip code', 'postal code'] },
    city: { required: true, aliases: [
      'by', 'poststed', 'sted', 'ort', 'city', 'town', 'area'] },
    country: { required: true, aliases: [
      'land', 'country'] },

    bankAccount: { aliases: [
      'bankkonto', 'kontonummer', 'konto', 'reg og konto', 'bank account',
      'account number', 'iban'] },
    bankAccountHolder: { aliases: [
      'kontohaver', 'kontoeier', 'kontoinnehaver', 'account holder'] },
    bic: { aliases: ['bic', 'swift', 'bic/swift', 'swift-kode'] },

    employeeNumber: { aliases: [
      'medarbejdernummer', 'medarbeidernummer', 'ansattnummer', 'ansatnummer',
      'employee number', 'employee no', 'medarb nr'] },
    startDate: { aliases: [
      'startdato', 'ansættelsesdato', 'ansettelsesdato', 'tiltrædelse',
      'start date', 'hire date', 'employed from'] },
    endDate: { aliases: [
      'slutdato', 'sluttdato', 'fratrædelse', 'end date', 'employed to'] },
    employmentType: { aliases: [
      'ansættelsestype', 'ansettelsestype', 'ansættelsesform', 'stillingstype',
      'employment type', 'contract type'] },
    position: { aliases: [
      'stilling', 'stillingsbetegnelse', 'titel', 'tittel', 'position',
      'job title'] },
    costCentre: { aliases: [
      'omkostningssted', 'kostnadssted', 'afdeling', 'avdeling', 'cost centre',
      'cost center', 'department'] },

    taxCard: { aliases: [
      'skattekort', 'skattekorttype', 'korttype', 'tax card'] },
    taxRate: { type: 'number', aliases: [
      'trækprocent', 'traekprocent', 'skatteprosent', 'skatteprocent',
      'tax rate', 'prosenttrekk'] },
    taxTable: { aliases: [
      'tabelnummer', 'tabellnummer', 'skattetabel', 'skattetabell',
      'tax table'] },
    taxMunicipality: { aliases: [
      'kommune', 'skattekommune', 'municipality', 'tax municipality'] }
  };

  /* ═══════════════════ DATALØN ═══════════════════
     Placeholders, every one of them. Fill these in from Visma's import
     specification and flip `verified` — until then the UI carries a warning
     and sendToDatalon() refuses. */
  var DATALON_CONFIG = {
    verified: false,
    employerNumber: '00000',          // ← fill in: Dataløn arbejdsgivernummer
    salaryType: '00',                 // ← fill in: lønart / employment code
    defaultCostCentre: '',            // ← fill in
    employmentCodes: {                // ← fill in: Dataløn's own codes
      hourly: 'H', salaried: 'F', temporary: 'V'
    },
    taxCardCodes: {                   // ← fill in
      hovedkort: '1', bikort: '2', frikort: '3',
      tabelltrekk: '1', prosenttrekk: '2'
    }
  };

  /* ═══════════════════ NORMALISE ═══════════════════ */

  /* Same character class as ib-import.js: a header arrives as "E-mail",
     "E mail" or "E.MAIL" depending on who exported it, and all three are the
     same column. Aliases go through this too, so a normalised header is never
     compared against a raw alias. */
  function norm(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/ /g, ' ')
      .toLowerCase().trim()
      .replace(/[._\-/()\\:]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  var NORM_ALIASES = {};
  Object.keys(COLUMNS).forEach(function (f) {
    NORM_ALIASES[f] = (COLUMNS[f].aliases || []).map(norm);
  });

  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return null;
    s = s.replace(/\s| /g, '');
    // "1.234,56" is Nordic; "1234.56" is not. Decide on the LAST separator.
    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else if (lastDot > lastComma) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  /* ═══════════════════ MAPPING ═══════════════════ */

  function mapColumns(headers) {
    var mapping = {};
    var used = {};
    var normalised = (headers || []).map(norm);

    Object.keys(COLUMNS).forEach(function (field) {
      var aliases = NORM_ALIASES[field];
      var i;
      for (i = 0; i < normalised.length; i++) {
        if (used[i] || !normalised[i]) continue;
        if (aliases.indexOf(normalised[i]) !== -1) {
          mapping[field] = i; used[i] = true; return;
        }
      }
      // second pass: prefix match, so "Postnummer (privat)" still lands
      for (i = 0; i < normalised.length; i++) {
        if (used[i] || !normalised[i]) continue;
        if (aliases.some(function (a) { return normalised[i].indexOf(a + ' ') === 0; })) {
          mapping[field] = i; used[i] = true; return;
        }
      }
    });

    var missing = Object.keys(COLUMNS).filter(function (f) {
      return COLUMNS[f].required && mapping[f] === undefined;
    });
    var unknown = normalised
      .map(function (h, i) { return used[i] || !h ? null : headers[i]; })
      .filter(Boolean);

    return { mapping: mapping, missing: missing, unknown: unknown };
  }

  /* ═══════════════════ VALIDATION ═══════════════════
     Pure. Writes nothing, stores nothing. Every row gets a verdict, and the
     row's own line number from the sheet so an error on "line 7" is line 7
     when the file is opened. */

  function rowRecord(row, mapping) {
    var rec = {};
    Object.keys(COLUMNS).forEach(function (field) {
      var i = mapping[field];
      if (i === undefined) { rec[field] = ''; return; }
      var raw = row.cells ? row.cells[i] : row[i];
      if (COLUMNS[field].type === 'number') {
        var n = toNumber(raw);
        rec[field] = n === null ? '' : n;
      } else {
        rec[field] = String(raw === null || raw === undefined ? '' : raw).trim();
      }
    });
    return rec;
  }

  function isBlank(rec) {
    return Object.keys(rec).every(function (k) { return rec[k] === '' || rec[k] === null; });
  }

  function validate(table, mapping, opts) {
    var o = opts || {};
    var existing = o.existing || [];
    var rows = (table && table.rows) || [];

    /* Two identity keys, because a personnel file has both and either one
       repeating is a duplicate. Compared normalised: a CPR number written
       with and without its hyphen is the same person. */
    var seenId = {}, seenEmail = {};
    var knownId = {}, knownEmail = {};
    existing.forEach(function (u) {
      if (u.personalId) knownId[idKey(u.personalId)] = u;
      if (u.email) knownEmail[norm(u.email)] = u;
    });

    var results = rows.map(function (row, i) {
      var line = (row && row.line) || (i + 2);
      var rec = rowRecord(row, mapping);

      if (isBlank(rec)) return { line: line, verdict: 'blank', record: rec, errors: [], warnings: [] };

      var errors = [], warnings = [];

      /* Two levels, the ones ib-lists.js already defines: `always` blocks
         registration outright, `payroll` only blocks being paid. A profile
         can be created in Dataløn without a tax card; it cannot be created
         without a name. */
      Lists.checkEmployee(rec, 'always').forEach(function (k) {
        errors.push({ field: k, code: 'required' });
      });
      var payrollGaps = Lists.checkEmployee(rec, 'payroll')
        .filter(function (k) { return !errors.some(function (e) { return e.field === k; }); });
      payrollGaps.forEach(function (k) { warnings.push({ field: k, code: 'payrollGap' }); });

      if (rec.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email)) {
        errors.push({ field: 'email', code: 'format' });
      }

      var ik = idKey(rec.personalId), ek = norm(rec.email);
      if (ik && knownId[ik]) errors.push({ field: 'personalId', code: 'duplicate' });
      else if (ek && knownEmail[ek]) errors.push({ field: 'email', code: 'duplicate' });
      else if (ik && seenId[ik]) errors.push({ field: 'personalId', code: 'duplicateInFile' });
      else if (ek && seenEmail[ek]) errors.push({ field: 'email', code: 'duplicateInFile' });

      if (ik) seenId[ik] = true;
      if (ek) seenEmail[ek] = true;

      return {
        line: line, record: rec, errors: errors, warnings: warnings,
        verdict: errors.length ? 'error' : (warnings.length ? 'warning' : 'ok')
      };
    });

    var counts = { ok: 0, warning: 0, error: 0, blank: 0 };
    results.forEach(function (r) { counts[r.verdict] += 1; });

    return {
      results: results,
      counts: counts,
      /* Error rows are skipped on commit, never coerced. */
      importable: results.filter(function (r) {
        return r.verdict === 'ok' || r.verdict === 'warning';
      })
    };
  }

  function idKey(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[\s-]/g, '').toLowerCase();
  }

  /* ═══════════════════ COMMIT ═══════════════════
     Stores the staged register. It does NOT create logins: these people are
     being registered in Dataløn, and handing out credentials is a separate
     decision that nobody made by uploading a spreadsheet. */
  function commit(validated, opts) {
    var o = opts || {};
    var now = o.now || new Date().toISOString().slice(0, 10);
    return validated.importable.map(function (r) {
      var rec = {};
      Object.keys(r.record).forEach(function (k) { rec[k] = r.record[k]; });
      rec.importedAt = now;
      rec.sourceLine = r.line;
      rec.datalonStatus = 'pending';
      return rec;
    });
  }

  /* ═══════════════════ DATALØN HANDOVER ═══════════════════ */

  function datalonRows(records) {
    return (records || []).map(function (rec) {
      return {
        employerNumber: DATALON_CONFIG.employerNumber,
        employeeNumber: rec.employeeNumber || '',
        personalId: rec.personalId || '',
        firstName: rec.firstName || '',
        lastName: rec.lastName || '',
        address: rec.street || '',
        zip: rec.zip || '',
        city: rec.city || '',
        country: rec.country || '',
        email: rec.email || '',
        phone: rec.phone || '',
        bankAccount: rec.bankAccount || '',
        startDate: rec.startDate || '',
        endDate: rec.endDate || '',
        employmentCode: DATALON_CONFIG.employmentCodes[rec.employmentType] || '',
        taxCardCode: DATALON_CONFIG.taxCardCodes[rec.taxCard] || '',
        taxRate: rec.taxRate === '' || rec.taxRate === null ? '' : rec.taxRate,
        taxTable: rec.taxTable || '',
        taxMunicipality: rec.taxMunicipality || '',
        costCentre: rec.costCentre || DATALON_CONFIG.defaultCostCentre,
        salaryType: DATALON_CONFIG.salaryType
      };
    });
  }

  function toDatalon(records, opts) {
    var o = opts || {};
    var rows = datalonRows(records);
    return {
      verified: DATALON_CONFIG.verified,
      employerNumber: DATALON_CONFIG.employerNumber,
      market: o.market || '',
      createdAt: o.now || new Date().toISOString().slice(0, 10),
      count: rows.length,
      rows: rows
    };
  }

  /* Semicolon-separated and BOM-prefixed: the variant Danish and Norwegian
     Excel opens without an import dialog. Same choice as toJeevesCSV. */
  function toDatalonCSV(records, opts) {
    var batch = toDatalon(records, opts);
    if (!batch.rows.length) return '';
    var cols = Object.keys(batch.rows[0]);
    var esc = function (v) {
      var s = String(v === null || v === undefined ? '' : v);
      return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [cols.join(';')];
    batch.rows.forEach(function (r) {
      lines.push(cols.map(function (c) { return esc(r[c]); }).join(';'));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /* Deliberately refuses. It assembles and checks the payload so the shape
     is exercised, then stops, because there is no agreed endpoint contract
     and guessing one would be worse than not having it. */
  function sendToDatalon(records, opts) {
    var batch = toDatalon(records, opts);
    var problems = [];
    if (!batch.rows.length) problems.push('EMPTY_BATCH');
    if (!DATALON_CONFIG.verified) problems.push('CONFIG_UNVERIFIED');
    batch.rows.forEach(function (r, i) {
      if (!r.personalId) problems.push('ROW_' + (i + 1) + '_NO_PERSONAL_ID');
      if (!r.lastName) problems.push('ROW_' + (i + 1) + '_NO_NAME');
    });
    return {
      sent: false,
      reason: 'NOT_IMPLEMENTED',
      detail: 'Dataløn has no agreed endpoint contract in this codebase. ' +
              'Fill in DATALON_CONFIG, flip verified, and implement the transport.',
      problems: problems,
      batch: batch
    };
  }

  /* ═══════════════════ TEMPLATE ═══════════════════ */

  function templateCSV(lang) {
    var da = lang !== 'nb';
    var cols = da
      ? ['Fornavn', 'Efternavn', 'CPR-nummer', 'E-mail', 'Telefon', 'Adresse',
         'Postnummer', 'By', 'Land', 'Bankkonto', 'Startdato',
         'Ansættelsestype', 'Skattekort', 'Trækprocent', 'Omkostningssted']
      : ['Fornavn', 'Etternavn', 'Fødselsnummer', 'E-post', 'Telefon', 'Gateadresse',
         'Postnummer', 'Poststed', 'Land', 'Bankkonto', 'Startdato',
         'Ansettelsestype', 'Skattekort', 'Skatteprosent', 'Kostnadssted'];
    var example = da
      ? ['Sara', 'Bergström', '150390-9999', 'sara@konsulent.dk', '+45 20 12 34 56',
         'Nørrebrogade 42', '2200', 'København', 'Danmark', '1234-0009999999',
         '2026-01-01', 'hourly', 'hovedkort', '38', '']
      : ['Sara', 'Bergström', '15039099999', 'sara@konsulent.no', '+47 400 12 345',
         'Storgata 18B', '0184', 'Oslo', 'Norge', '12345699999',
         '2026-01-01', 'hourly', 'tabelltrekk', '32', ''];
    return '﻿' + cols.join(';') + '\r\n' + example.join(';') + '\r\n';
  }

  var API = {
    COLUMNS: COLUMNS, LIMITS: LIMITS, DATALON_CONFIG: DATALON_CONFIG,
    norm: norm, toNumber: toNumber, idKey: idKey,
    mapColumns: mapColumns, validate: validate, commit: commit,
    datalonRows: datalonRows, toDatalon: toDatalon, toDatalonCSV: toDatalonCSV,
    sendToDatalon: sendToDatalon, templateCSV: templateCSV
  };

  global.IBStaff = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
