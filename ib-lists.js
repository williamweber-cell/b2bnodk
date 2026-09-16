/* ═══════════════════════════════════════════════════════════════════════════
   ib-lists.js — employee and payout list generation

   Two list types are needed to onboard a person into a payroll/HR system:

     EMPLOYEE LIST  registers the person   (once, per person)
     PAYOUT LIST    registers what to pay  (per period, per assignment)

   ── THE SHAPE OF THIS MODULE ──
   A canonical schema plus per-system PROFILES, the same arrangement used for
   the Jeeves export. Every system wants the same facts under different column
   names, in a different order, with a different subset required. Encoding
   that as profiles means adding a system is a config entry, not a rewrite —
   which is the point of doing the general layout first.

   ── ON THE FRILANS FINANS TEMPLATES ──
   The supplied FF Norway templates are the starting point and ship as the
   `ff-no` profile, matching their columns exactly. Two observations worth
   acting on before those become the house standard:

   1. The employee template has no employment or tax fields — no start date,
      no employment type, no tax card, no tax municipality. Every payroll
      system needs those, so they are in the canonical schema and simply not
      emitted by the `ff-no` profile.

   2. The payout template collapses dates and hours into one free-text column
      ("Dates and hours"). That cannot be validated, summed or reconciled.
      The canonical schema keeps dateFrom / dateTo / hours separate, and the
      `ff-no` profile composes the single column on the way out. Nothing is
      lost, and the structured form is available the moment a system can take
      it.

   ── PII ──
   These lists carry national identity numbers and bank details. buildEmployee
   takes { includeSensitive }, defaulting to true because the list is useless
   without them, but every sensitive field is flagged so a caller can produce
   a redacted copy for review or circulation.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var IB = global.IB || (typeof require === 'function' ? require('./ib-core.js') : null);

  /* ═══════════════════ CANONICAL EMPLOYEE SCHEMA ═══════════════════

     required: 'always'   — no system will accept the person without it
               'payroll'  — needed before the first payout, not at registration
               false      — optional everywhere

     sensitive: personal data that should not be circulated casually.        */

  var EMPLOYEE_FIELDS = [
    /* ── identity ── */
    { key: 'firstName', header: 'First name',   group: 'identity', required: 'always',  width: 18, type: 'string' },
    { key: 'lastName', header: 'Surname',    group: 'identity', required: 'always',  width: 18, type: 'string' },
    { key: 'personalId', header: 'Personal ID',  group: 'identity', required: 'always',  width: 18, type: 'text',
      sensitive: true,
      note: 'CPR-nummer (DK) / fødselsnummer (NO). Text, never numeric — leading zeros matter.' },
    { key: 'dateOfBirth', header: 'Date of birth', group: 'identity', required: false,     width: 14, type: 'date',
      note: 'Derivable from personalId in both markets; some systems want it separately.' },

    /* ── contact ── */
    { key: 'email', header: 'E-mail',       group: 'contact',  required: 'always',  width: 26, type: 'string' },
    { key: 'phone', header: 'Phone number',       group: 'contact',  required: false,     width: 16, type: 'text' },
    { key: 'street', header: 'Street address',      group: 'contact',  required: 'always',  width: 26, type: 'string' },
    { key: 'zip', header: 'ZIP code',         group: 'contact',  required: 'always',  width: 10, type: 'text',
      note: 'Text: Danish and Norwegian postal codes have leading zeros.' },
    { key: 'city', header: 'Area',        group: 'contact',  required: 'always',  width: 18, type: 'string' },
    { key: 'country', header: 'Country',     group: 'contact',  required: 'always',  width: 14, type: 'string' },

    /* ── payment ── */
    { key: 'bankAccount', header: 'Bank account', group: 'payment',  required: 'payroll', width: 22, type: 'text',
      sensitive: true,
      note: 'NO: 11 digits. DK: reg.nr + kontonummer. Text in both cases.' },
    { key: 'bankAccountHolder', header: 'Bank account holder if in other name', group: 'payment', required: false, width: 26, type: 'string',
      sensitive: true, note: 'Only when the account is not in the employee’s own name.' },
    { key: 'bic', header: 'BIC/SWIFT',         group: 'payment',  required: false,     width: 14, type: 'text',
      note: 'Needed for cross-border payment only.' },

    /* ── employment — absent from the FF template, required by payroll ── */
    { key: 'employeeNumber', header: 'Employee number', group: 'employment', required: false, width: 14, type: 'text',
      note: 'Assigned by the target system; blank on first registration.' },
    { key: 'startDate', header: 'Start date',   group: 'employment', required: 'payroll', width: 14, type: 'date' },
    { key: 'endDate', header: 'End date',     group: 'employment', required: false,     width: 14, type: 'date' },
    { key: 'employmentType', header: 'Employment type', group: 'employment', required: 'payroll', width: 18, type: 'string',
      note: 'hourly | salaried | temporary. Drives holiday-pay and ATP handling.' },
    { key: 'position', header: 'Position',    group: 'employment', required: false,     width: 22, type: 'string' },
    { key: 'costCentre', header: 'Cost centre',  group: 'employment', required: false,     width: 14, type: 'text' },

    /* ── tax — absent from the FF template, required by payroll ── */
    { key: 'taxCard', header: 'Tax card',     group: 'tax', required: 'payroll', width: 16, type: 'string',
      note: 'DK: hovedkort / bikort / frikort. NO: skattekort status.' },
    { key: 'taxRate', header: 'Tax rate %',     group: 'tax', required: false,     width: 12, type: 'number',
      note: 'Trækprocent (DK) / trekkprosent (NO). Blank means use the table.' },
    { key: 'taxTable', header: 'Tax table',    group: 'tax', required: false,     width: 12, type: 'text',
      note: 'NO tabelltrekk, e.g. 7100.' },
    { key: 'taxMunicipality', header: 'Tax municipality', group: 'tax', required: false, width: 18, type: 'string',
      note: 'NO: skattekommune, also decides the arbeidsgiveravgift zone.' }
  ];

  /* ═══════════════════ CANONICAL PAYOUT SCHEMA ═══════════════════ */

  var PAYOUT_FIELDS = [
    { key: 'name', header: 'Name',          required: 'always',  width: 24, type: 'string' },
    { key: 'employeeRef', header: 'Employee ref',   required: false,     width: 24, type: 'string',
      note: 'Email or employee number. Matching on name alone breaks on duplicates.' },
    { key: 'personalId', header: 'Personal ID', required: false, width: 18, type: 'text', sensitive: true },
    { key: 'invoiceAmount', header: 'Invoice amount excl. VAT', required: 'always',  width: 18, type: 'number',
      note: 'Excluding VAT.' },
    { key: 'dateFrom', header: 'Date from',      required: 'always',  width: 13, type: 'date' },
    { key: 'dateTo', header: 'Date to',        required: 'always',  width: 13, type: 'date' },
    { key: 'hours', header: 'Hours',         required: 'always',  width: 10, type: 'number' },
    { key: 'hourlyRate', header: 'Hourly rate',    required: false,     width: 12, type: 'number' },
    { key: 'period', header: 'Period',        required: false,     width: 14, type: 'string' },
    { key: 'companyName', header: 'Company',   required: false,     width: 24, type: 'string' },
    { key: 'assignmentId', header: 'Assignment ID',  required: false,     width: 16, type: 'text' },
    { key: 'description', header: 'Description',   required: false,     width: 34, type: 'string' },
    { key: 'costCentre', header: 'Cost centre', required: false, width: 14, type: 'text' }
  ];

  /* ═══════════════════ PROFILES ═══════════════════

     A profile picks fields, orders them, and names the columns. `compose`
     builds a column from several canonical fields; `banner` reproduces a
     template's title row.

     Add a system by adding an entry here. Nothing else changes.            */

  var PROFILES = {

    /* Everything, canonical names. The working format. */
    general: {
      label: 'Generell (alle felter)',
      employee: {
        sheet: 'Employees',
        banner: '',
        columns: EMPLOYEE_FIELDS.map(function (f) { return { field: f.key }; })
      },
      payout: {
        sheet: 'Payouts',
        banner: '',
        columns: PAYOUT_FIELDS.map(function (f) { return { field: f.key }; })
      }
    },

    /* Frilans Finans Norway — matches the supplied templates column for
       column, including the banner row and the combined dates/hours cell. */
    'ff-no': {
      label: 'Frilans Finans Norge',
      employee: {
        sheet: 'Personal data',
        banner: 'Personal data',
        columns: [
          { field: 'firstName',          header: 'First name' },
          { field: 'lastName',           header: 'Surname' },
          { field: 'street',             header: 'Street Address' },
          { field: 'zip',                header: 'ZIP code' },
          { field: 'city',               header: 'Area' },
          { field: 'country',            header: 'Country' },
          { field: 'email',              header: 'E-mail' },
          { field: 'phone',              header: 'Phone number' },
          { field: 'personalId',         header: 'Personal ID' },
          { field: 'bankAccountHolder',  header: 'Bank account holder if in other name' },
          { field: 'bankAccount',        header: 'Bank account', width: 20 }
        ]
      },
      payout: {
        sheet: 'Payouts Registration',
        banner: 'Payouts Registration',
        columns: [
          { field: 'name',          header: 'Name' },
          { field: 'invoiceAmount', header: 'Invoice amount excl. VAT', width: 20 },
          { header: 'Dates and hours', width: 26, compose: composeDatesAndHours }
        ]
      }
    },

    /* Same shape for the Danish entity. Separate profile because the labels
       and the identity/account formats differ even though the columns line up. */
    'ff-dk': {
      label: 'Frilans Finans Danmark',
      employee: {
        sheet: 'Personal data',
        banner: 'Personal data',
        columns: [
          { field: 'firstName',          header: 'First name' },
          { field: 'lastName',           header: 'Surname' },
          { field: 'street',             header: 'Street Address' },
          { field: 'zip',                header: 'ZIP code' },
          { field: 'city',               header: 'Area' },
          { field: 'country',            header: 'Country' },
          { field: 'email',              header: 'E-mail' },
          { field: 'phone',              header: 'Phone number' },
          { field: 'personalId',         header: 'Personal ID (CPR)' },
          { field: 'bankAccountHolder',  header: 'Bank account holder if in other name' },
          { field: 'bankAccount',        header: 'Bank account (reg. + konto)', width: 24 }
        ]
      },
      payout: {
        sheet: 'Payouts Registration',
        banner: 'Payouts Registration',
        columns: [
          { field: 'name',          header: 'Name' },
          { field: 'invoiceAmount', header: 'Invoice amount excl. VAT', width: 20 },
          { header: 'Dates and hours', width: 26, compose: composeDatesAndHours }
        ]
      }
    },

    /* Payroll-system oriented: identity, employment and tax, no marketing
       fields. The shape most HR/payroll imports actually want. */
    payroll: {
      label: 'Lønnssystem (identitet, ansettelse, skatt)',
      employee: {
        sheet: 'Employees',
        banner: '',
        columns: [
          'employeeNumber','firstName','lastName','personalId','dateOfBirth',
          'email','phone','street','zip','city','country',
          'startDate','endDate','employmentType','position','costCentre',
          'taxCard','taxRate','taxTable','taxMunicipality',
          'bankAccount','bankAccountHolder','bic'
        ].map(function (k) { return { field: k }; })
      },
      payout: {
        sheet: 'Payouts',
        banner: '',
        columns: [
          'employeeRef','name','period','dateFrom','dateTo','hours','hourlyRate',
          'invoiceAmount','costCentre','assignmentId','description'
        ].map(function (k) { return { field: k }; })
      }
    }
  };

  /* FF puts dates and hours in one cell. Reproduce that on export only. */
  function composeDatesAndHours(rec) {
    var span = (rec.dateFrom && rec.dateTo)
      ? (rec.dateFrom === rec.dateTo ? rec.dateFrom : rec.dateFrom + '–' + rec.dateTo)
      : (rec.dateFrom || rec.dateTo || rec.period || '');
    var hours = (rec.hours || rec.hours === 0) ? rec.hours + ' t' : '';
    return [span, hours].filter(Boolean).join(', ');
  }

  /* ═══════════════════ FIELD LOOKUP ═══════════════════ */

  var EMP_BY_KEY = {}, PAY_BY_KEY = {};
  EMPLOYEE_FIELDS.forEach(function (f) { EMP_BY_KEY[f.key] = f; });
  PAYOUT_FIELDS.forEach(function (f) { PAY_BY_KEY[f.key] = f; });

  /* Column headers are canonical English and deliberately NOT localised:
     these files are read by other payroll systems, whose column mapping
     would break the moment the header changed language. The UI around the
     generator is translated; the file contents are not. */
  function labelFor(key, kind) {
    var f = (kind === 'employee' ? EMP_BY_KEY : PAY_BY_KEY)[key];
    return (f && f.header) || key;
  }

  /* ═══════════════════ RECORD MAPPING ═══════════════════

     The app stores a consultant, not an employee record. This lifts one into
     canonical shape and leaves unknown fields blank rather than inventing
     them — a guessed tax card is worse than an empty cell. */

  function employeeFromUser(user, market) {
    var parts = String(user.name || '').trim().split(/\s+/);
    var first = parts.shift() || '';
    var last = parts.join(' ');
    return {
      firstName: first,
      lastName: last,
      personalId: user.personalId || '',
      dateOfBirth: user.dateOfBirth || '',
      email: user.email || '',
      phone: user.phone || '',
      street: user.street || '',
      zip: user.zip || '',
      city: user.city || '',
      country: user.country || market.name,
      bankAccount: user.bankAccount || '',
      bankAccountHolder: user.bankAccountHolder || '',
      bic: user.bic || '',
      employeeNumber: user.employeeNumber || '',
      startDate: user.joined || '',
      endDate: user.endDate || '',
      employmentType: user.employmentType || '',
      position: user.position || '',
      costCentre: user.costCentre || '',
      taxCard: user.taxCard || '',
      taxRate: typeof user.taxRate === 'number' ? user.taxRate : '',
      taxTable: user.taxTable || '',
      taxMunicipality: user.taxMunicipality || '',
      _id: user.id
    };
  }

  function payoutFromAssignment(a, usersById) {
    var u = usersById[a.consultantId] || {};
    return {
      name: a.consultantName || u.name || '',
      employeeRef: a.consultantEmail || u.email || '',
      personalId: u.personalId || '',
      invoiceAmount: a.amount,
      dateFrom: a.dateFrom || a.createdDate || '',
      dateTo: a.dateTo || a.approvedDate || a.createdDate || '',
      hours: a.hours,
      hourlyRate: a.hourlyRate,
      period: a.period || '',
      companyName: a.companyName || '',
      assignmentId: a.id || '',
      description: a.description || '',
      costCentre: a.costCentre || '',
      _id: a.id
    };
  }

  /* ═══════════════════ COMPLETENESS ═══════════════════

     Which people cannot be registered yet, and what is missing. This is the
     part that saves the round trip: you find out before you send the file,
     not when the target system rejects it. */

  function checkEmployee(rec, level) {
    var want = level === 'payroll' ? ['always', 'payroll'] : ['always'];
    return EMPLOYEE_FIELDS.filter(function (f) {
      return want.indexOf(f.required) !== -1 &&
             (rec[f.key] === '' || rec[f.key] === null || rec[f.key] === undefined);
    }).map(function (f) { return f.key; });
  }

  function checkPayout(rec) {
    return PAYOUT_FIELDS.filter(function (f) {
      return f.required === 'always' &&
             (rec[f.key] === '' || rec[f.key] === null || rec[f.key] === undefined);
    }).map(function (f) { return f.key; });
  }

  /* ═══════════════════ BUILD ═══════════════════ */

  function resolveColumns(spec, kind, opts) {
    return spec.columns.map(function (c) {
      var f = (kind === 'employee' ? EMP_BY_KEY : PAY_BY_KEY)[c.field] || {};
      return {
        field: c.field,
        compose: c.compose,
        header: c.header || labelFor(c.field, kind),
        width: c.width || f.width || 18,
        type: c.type || f.type || 'string',
        sensitive: !!f.sensitive
      };
    }).filter(function (c) {
      return opts.includeSensitive === false ? !c.sensitive : true;
    });
  }

  function rowsFor(records, columns) {
    return records.map(function (rec) {
      return columns.map(function (c) {
        if (c.compose) return c.compose(rec);
        var v = rec[c.field];
        return (v === undefined || v === null) ? '' : v;
      });
    });
  }

  /* records → { sheet, title, columns, rows, issues } ready for the writer */
  function buildEmployeeList(records, opts) {
    var o = opts || {};
    var profile = PROFILES[o.profile || 'general'];
    if (!profile) throw new Error('UNKNOWN_PROFILE_' + o.profile);
    var columns = resolveColumns(profile.employee, 'employee', o);
    var level = o.level || 'always';
    return {
      profile: o.profile || 'general',
      sheet: profile.employee.sheet,
      title: o.banner === false ? '' : profile.employee.banner,
      columns: columns,
      rows: rowsFor(records, columns),
      issues: records.map(function (r, i) {
        return { index: i, id: r._id, name: (r.firstName + ' ' + r.lastName).trim(),
                 missing: checkEmployee(r, level) };
      }).filter(function (x) { return x.missing.length; })
    };
  }

  function buildPayoutList(records, opts) {
    var o = opts || {};
    var profile = PROFILES[o.profile || 'general'];
    if (!profile) throw new Error('UNKNOWN_PROFILE_' + o.profile);
    var columns = resolveColumns(profile.payout, 'payout', o);
    return {
      profile: o.profile || 'general',
      sheet: profile.payout.sheet,
      title: o.banner === false ? '' : profile.payout.banner,
      columns: columns,
      rows: rowsFor(records, columns),
      issues: records.map(function (r, i) {
        return { index: i, id: r._id, name: r.name, missing: checkPayout(r) };
      }).filter(function (x) { return x.missing.length; })
    };
  }

  /* ═══════════════════ FROM STORED DATA ═══════════════════ */

  function employeesFromStore(opts) {
    var o = opts || {};
    var market = IB.market();
    var users = IB.getUsers().filter(function (u) { return u.role === 'consultant'; });
    if (o.ids && o.ids.length) {
      users = users.filter(function (u) { return o.ids.indexOf(u.id) !== -1; });
    }
    return users.map(function (u) { return employeeFromUser(u, market); });
  }

  function payoutsFromStore(opts) {
    var o = opts || {};
    var usersById = {};
    IB.getUsers().forEach(function (u) { usersById[u.id] = u; });
    var list = IB.getAssignments();
    if (o.statuses && o.statuses.length) {
      list = list.filter(function (a) { return o.statuses.indexOf(a.status) !== -1; });
    }
    if (o.period) list = list.filter(function (a) { return a.period === o.period; });
    return list.map(function (a) { return payoutFromAssignment(a, usersById); });
  }

  /* ═══════════════════ CSV ═══════════════════
     Semicolon-separated with a BOM, which is what Danish and Norwegian Excel
     expects. Numbers use a decimal comma for the same reason. */
  function toCSV(list, market) {
    var m = market || IB.market();
    var esc = function (v) {
      if (v === null || v === undefined) return '';
      var s = typeof v === 'number'
        ? String(v).replace('.', m.locale === 'da-DK' || m.locale === 'nb-NO' ? ',' : '.')
        : String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [];
    if (list.title) lines.push(esc(list.title));
    lines.push(list.columns.map(function (c) { return esc(c.header); }).join(';'));
    list.rows.forEach(function (r) { lines.push(r.map(esc).join(';')); });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function toSheetSpec(list) {
    return {
      sheet: list.sheet,
      title: list.title,
      columns: list.columns.map(function (c) {
        return { header: c.header, width: c.width, type: c.type };
      }),
      rows: list.rows
    };
  }

  function fileName(kind, profileKey, market) {
    var m = market || IB.market();
    return [kind, profileKey, m.code.toLowerCase(), IB.today().replace(/-/g, '')]
      .join('-');
  }

  var API = {
    EMPLOYEE_FIELDS: EMPLOYEE_FIELDS,
    PAYOUT_FIELDS: PAYOUT_FIELDS,
    PROFILES: PROFILES,
    employeeFromUser: employeeFromUser,
    payoutFromAssignment: payoutFromAssignment,
    employeesFromStore: employeesFromStore,
    payoutsFromStore: payoutsFromStore,
    checkEmployee: checkEmployee,
    checkPayout: checkPayout,
    buildEmployeeList: buildEmployeeList,
    buildPayoutList: buildPayoutList,
    composeDatesAndHours: composeDatesAndHours,
    toCSV: toCSV,
    toSheetSpec: toSheetSpec,
    fileName: fileName
  };

  global.IBLists = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
