/* ═══════════════════════════════════════════════════════════════════════════
   ib-import.js — payroll-basis import and Jeeves export

   Pipeline:

     file → IBXlsx.readTable → mapColumns → validate → (preview) → commit
                                                              ↓
                                                    assignments (pending)
                                                              ↓
                                          approve → payroll run → toJeeves

   Nothing is written until commit(). validate() is pure: it returns a row-by-
   row verdict for the preview table, so the user sees exactly what will and
   will not be created before anything happens.

   Two scopes:
     'company' — a client company importing its own payroll basis. The
                 company is the logged-in user; the file must not name one.
     'admin'   — superadmin importing across companies. The file MUST carry a
                 company column, and every row is checked against the
                 register.

   ── JEEVES ──
   The export builds a payroll batch from paid assignments. The envelope and
   field names below are a reasonable default, NOT your Jeeves instance's
   spec: wage-type codes (lönearter), cost-centre and employee-number schemes
   are configured per installation. JEEVES_CONFIG is where that mapping lives
   and is meant to be edited once you have the integration spec. The API path
   is deliberately a stub — it assembles and validates the payload, and does
   not invent an endpoint contract.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const IB = global.IB || (typeof require === 'function' ? require('./ib-core.js') : null);

  /* ═══════════════════ COLUMN MAPPING ═══════════════════
     Header matching is case-insensitive, ignores punctuation and spacing, and
     accepts several spellings per market — a file exported from Jeeves, from
     a time system, or typed by hand will not all agree on wording. */

  const COLUMNS = {
    companyEmail: {
      scope: 'admin', required: true,
      aliases: ['virksomhed e-mail', 'virksomhed', 'virksomheds e-mail', 'kunde e-mail', 'kunde',
                'bedrift e-post', 'bedrift', 'oppdragsgiver', 'oppdragsgiver e-post',
                'company email', 'company', 'customer email']
    },
    consultantEmail: {
      required: true,
      aliases: ['konsulent e-mail', 'konsulent e-post', 'konsulent', 'konsulent email',
                'medarbejder e-mail', 'medarbeider e-post', 'ansatt e-post', 'ansat e-mail',
                'consultant email', 'employee email', 'e-mail', 'e-post', 'email']
    },
    period: {
      required: true,
      aliases: ['periode', 'lønperiode', 'lønnsperiode', 'måned', 'maned', 'month', 'period']
    },
    description: {
      required: false,
      aliases: ['beskrivelse', 'beskrivning', 'tekst', 'opgave', 'oppdrag', 'arbejde', 'arbeid',
                'description', 'text', 'note']
    },
    hours: {
      required: true, type: 'number',
      aliases: ['timer', 'antal timer', 'antall timer', 'arbejdstimer', 'arbeidstimer',
                'hours', 'qty', 'antal', 'antall']
    },
    hourlyRate: {
      required: true, type: 'number',
      aliases: ['timeløn', 'timelønn', 'timepris', 'timesats', 'sats', 'takst',
                'hourly rate', 'rate', 'pris']
    },
    type: {
      required: false,
      aliases: ['ydelse', 'tjeneste', 'type', 'ydelsestype', 'tjenestetype', 'service']
    }
  };

  function norm(s) {
    return String(s === null || s === undefined ? '' : s)
      .toLowerCase().trim()
      .replace(/[._\-/()]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  /* Aliases go through the same normaliser as the headers. Comparing a
     normalised header ("e post") against a raw alias ("e-post") silently
     never matches, which is easy to miss because the longer aliases still
     land via the prefix pass. */
  const NORM_ALIASES = {};
  Object.keys(COLUMNS).forEach(f => { NORM_ALIASES[f] = COLUMNS[f].aliases.map(norm); });

  /* headers → { field: columnIndex }, plus what is missing and what was
     ignored. Unknown columns are not an error: payroll exports routinely
     carry cost centres, project codes and employee numbers we do not use. */
  function mapColumns(headers, scope) {
    const mapping = {};
    const used = new Set();
    const normalised = headers.map(norm);

    Object.keys(COLUMNS).forEach(field => {
      const spec = COLUMNS[field];
      if (spec.scope && spec.scope !== scope) return;
      const aliases = NORM_ALIASES[field];
      for (let i = 0; i < normalised.length; i++) {
        if (used.has(i) || !normalised[i]) continue;
        if (aliases.indexOf(normalised[i]) !== -1) {
          mapping[field] = i; used.add(i); return;
        }
      }
      // second pass: prefix match, so "Timer (faktureret)" still lands
      for (let i = 0; i < normalised.length; i++) {
        if (used.has(i) || !normalised[i]) continue;
        if (aliases.some(a => normalised[i].startsWith(a + ' '))) {
          mapping[field] = i; used.add(i); return;
        }
      }
    });

    const missing = Object.keys(COLUMNS).filter(f => {
      const spec = COLUMNS[f];
      if (spec.scope && spec.scope !== scope) return false;
      return spec.required && mapping[f] === undefined;
    });

    const unknown = headers
      .map((h, i) => ({ h, i }))
      .filter(x => x.h && !used.has(x.i))
      .map(x => x.h);

    return { mapping, missing, unknown };
  }

  /* ═══════════════════ VALIDATION ═══════════════════ */

  const LIMITS = {
    maxHours: 744,        // hours in a 31-day month; anything above is a typo
    maxRate: 100000,      // per hour, in local currency
    maxRows: 2000
  };

  function toNumber(v) {
    if (typeof v === 'number') return v;
    const s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return NaN;
    // Nordic input: "1 234,50" and "1.234,50" both mean 1234.50
    let t = s.replace(/[\s ]/g, '');
    if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const n = Number(t);
    return isNaN(n) ? NaN : n;
  }

  function cell(row, mapping, field) {
    const i = mapping[field];
    return i === undefined ? '' : row.cells[i];
  }

  /* Pure. Returns a verdict per row plus a summary. Nothing is written. */
  function validate(table, ctx) {
    const scope = ctx.scope;
    const users = ctx.users || [];
    const existing = ctx.existing || [];
    const { mapping, missing, unknown } = mapColumns(table.headers, scope);

    const result = {
      mapping, missing, unknown,
      sheet: table.sheet,
      rows: [],
      summary: { total: 0, ok: 0, warning: 0, error: 0, amount: 0 }
    };

    if (missing.length) {
      result.fatal = 'MISSING_COLUMNS';
      return result;
    }
    if (table.rows.length > LIMITS.maxRows) {
      result.fatal = 'TOO_MANY_ROWS';
      result.fatalDetail = String(table.rows.length);
      return result;
    }

    const consultants = users.filter(u => u.role === 'consultant');
    const companies = users.filter(u => u.role === 'company');
    const byEmail = list => {
      const m = {};
      list.forEach(u => { m[String(u.email).toLowerCase().trim()] = u; });
      return m;
    };
    const consultantBy = byEmail(consultants);
    const companyBy = byEmail(companies);
    const validTypes = Object.values(IB.TYPE);

    // Fingerprints for duplicate detection, within the file and against the DB.
    const seen = new Set();
    const existingKeys = new Set(existing.map(a =>
      [a.consultantId, a.companyId, norm(a.period), norm(a.description), a.hours, a.hourlyRate].join('|')));

    table.rows.forEach(row => {
      const issues = [];
      const raw = {
        companyEmail: String(cell(row, mapping, 'companyEmail') || '').toLowerCase().trim(),
        consultantEmail: String(cell(row, mapping, 'consultantEmail') || '').toLowerCase().trim(),
        period: String(cell(row, mapping, 'period') || '').trim(),
        description: String(cell(row, mapping, 'description') || '').trim(),
        hours: cell(row, mapping, 'hours'),
        hourlyRate: cell(row, mapping, 'hourlyRate'),
        type: String(cell(row, mapping, 'type') || '').trim()
      };

      // ── company ──
      let company = null;
      if (scope === 'admin') {
        if (!raw.companyEmail) issues.push({ level: 'error', key: 'import.err.companyMissing' });
        else {
          company = companyBy[raw.companyEmail] || null;
          if (!company) issues.push({ level: 'error', key: 'import.err.companyUnknown', detail: raw.companyEmail });
        }
      } else {
        company = ctx.company || null;
        if (!company) issues.push({ level: 'error', key: 'import.err.companyMissing' });
        if (raw.companyEmail && company &&
            raw.companyEmail !== String(company.email).toLowerCase()) {
          issues.push({ level: 'warning', key: 'import.warn.companyIgnored', detail: raw.companyEmail });
        }
      }

      // ── consultant ──
      let consultant = null;
      if (!raw.consultantEmail) issues.push({ level: 'error', key: 'import.err.consultantMissing' });
      else {
        consultant = consultantBy[raw.consultantEmail] || null;
        if (!consultant) issues.push({ level: 'error', key: 'import.err.consultantUnknown', detail: raw.consultantEmail });
      }

      // ── period ──
      if (!raw.period) issues.push({ level: 'error', key: 'import.err.periodMissing' });

      // ── hours ──
      const hours = toNumber(raw.hours);
      if (isNaN(hours)) issues.push({ level: 'error', key: 'import.err.hoursNaN', detail: String(raw.hours) });
      else if (hours <= 0) issues.push({ level: 'error', key: 'import.err.hoursRange', detail: String(hours) });
      else if (hours > LIMITS.maxHours) issues.push({ level: 'error', key: 'import.err.hoursRange', detail: String(hours) });

      // ── rate ──
      const rate = toNumber(raw.hourlyRate);
      if (isNaN(rate)) issues.push({ level: 'error', key: 'import.err.rateNaN', detail: String(raw.hourlyRate) });
      else if (rate <= 0) issues.push({ level: 'error', key: 'import.err.rateRange', detail: String(rate) });
      else if (rate > LIMITS.maxRate) issues.push({ level: 'error', key: 'import.err.rateRange', detail: String(rate) });

      // ── description ──
      let description = raw.description;
      if (!description) {
        description = raw.period ? raw.period : '—';
        issues.push({ level: 'warning', key: 'import.warn.descriptionDefaulted' });
      }

      // ── service type ──
      let type = raw.type;
      if (!type) {
        type = IB.TYPE.EXCEL_IMPORT;
      } else {
        const hit = validTypes.find(t => norm(t) === norm(type));
        if (hit) type = hit;
        else {
          issues.push({ level: 'warning', key: 'import.warn.typeDefaulted', detail: type });
          type = IB.TYPE.EXCEL_IMPORT;
        }
      }

      // ── duplicates ──
      const fp = [raw.consultantEmail, company ? company.id : raw.companyEmail,
                  norm(raw.period), norm(description), hours, rate].join('|');
      if (seen.has(fp)) issues.push({ level: 'warning', key: 'import.warn.duplicateInFile' });
      seen.add(fp);

      if (consultant && company) {
        const dbKey = [consultant.id, company.id, norm(raw.period), norm(description), hours, rate].join('|');
        if (existingKeys.has(dbKey)) issues.push({ level: 'warning', key: 'import.warn.duplicateExisting' });
      }

      const hasError = issues.some(i => i.level === 'error');
      const amount = (!isNaN(hours) && !isNaN(rate)) ? hours * rate : 0;

      result.rows.push({
        line: row.line,
        status: hasError ? 'error' : (issues.length ? 'warning' : 'ok'),
        issues,
        amount,
        data: hasError ? null : {
          consultantId: consultant.id,
          consultantName: consultant.name,
          consultantEmail: consultant.email,
          companyId: company.id,
          companyName: company.name,
          companyEmail: company.email,
          type,
          description,
          hours,
          hourlyRate: rate,
          amount,
          period: raw.period
        }
      });
    });

    result.summary.total = result.rows.length;
    result.rows.forEach(r => {
      result.summary[r.status]++;
      if (r.status !== 'error') result.summary.amount += r.amount;
    });
    return result;
  }

  /* ═══════════════════ COMMIT ═══════════════════
     Creates one pending assignment per non-error row. Error rows are skipped,
     never silently coerced. Returns what was created so the UI can report it
     precisely rather than saying "done". */
  function commit(validated, ctx) {
    const list = IB.getAssignments();
    const created = [];
    const batchId = 'IMP-' + IB.today().replace(/-/g, '') + '-' +
                    String(Math.floor(Math.random() * 9000) + 1000);

    validated.rows.filter(r => r.status !== 'error').forEach(r => {
      const id = IB.nextAssignmentId(list.concat(created));
      const a = Object.assign({
        id,
        status: IB.STATUS.PENDING,
        createdDate: IB.today(),
        approvedDate: '',
        adminNote: '',
        source: 'excel-import',
        importBatch: batchId,
        importLine: r.line
      }, r.data);
      created.push(a);
    });

    if (created.length) IB.saveAssignments(created.concat(list));
    return { batchId, created, skipped: validated.rows.filter(r => r.status === 'error').length };
  }

  /* ═══════════════════ JEEVES EXPORT ═══════════════════

     A payroll batch for the ERP. The shape below is a documented default —
     replace the codes with your Jeeves installation's own once you have the
     integration spec. Every field that is an assumption is listed in
     JEEVES_CONFIG rather than buried in the builder. */

  const JEEVES_CONFIG = {
    formatVersion: 'jeeves-payroll-batch-v1',
    verified: false,               // flip when the mapping is confirmed
    // Wage-type codes (lönearter). These are placeholders.
    wageType: {
      'SalaryInvoicing':     '110',
      'Excel-import':        '110',
      'API-integration':     '110',
      'Workforce Management':'110'
    },
    holidayWageType: '170',        // feriepenger / feriegodtgørelse
    defaultCostCentre: '',
    // Company code in Jeeves per market.
    companyCode: { DK: 'IBDK', NO: 'IBNO' },
    endpoint: ''                   // set per environment; empty = export only
  };

  function jeevesRows(assignments, market) {
    return assignments.map(a => {
      const p = IB.calcPayroll(a.amount, { hours: a.hours });
      return {
        companyCode:    JEEVES_CONFIG.companyCode[market.code] || market.code,
        batchReference: a.importBatch || a.id,
        assignmentId:   a.id,
        employeeRef:    a.consultantId,
        employeeEmail:  a.consultantEmail || '',
        employeeName:   a.consultantName,
        customerRef:    a.companyId,
        customerName:   a.companyName,
        period:         a.period,
        wageType:       JEEVES_CONFIG.wageType[a.type] || JEEVES_CONFIG.wageType['SalaryInvoicing'],
        costCentre:     a.costCentre || JEEVES_CONFIG.defaultCostCentre,
        quantity:       IB.round2(a.hours),
        unitPrice:      IB.round2(a.hourlyRate),
        invoiceAmount:  IB.round2(p.invoiceAmount),
        serviceFee:     IB.round2(p.serviceFee),
        salaryBase:     IB.round2(p.salaryBase),
        grossSalary:    IB.round2(p.gross),
        holidayPay:     IB.round2(p.holidayPay),
        employerCost:   IB.round2(p.employerCost),
        withholding:    IB.round2(p.withholding),
        netSalary:      IB.round2(p.net),
        currency:       market.currency,
        description:    a.description
      };
    });
  }

  function toJeeves(assignments, market) {
    const m = market || IB.market();
    const rows = jeevesRows(assignments, m);
    const totals = rows.reduce((t, r) => {
      t.invoiceAmount += r.invoiceAmount;
      t.grossSalary += r.grossSalary;
      t.netSalary += r.netSalary;
      t.employerCost += r.employerCost;
      return t;
    }, { invoiceAmount: 0, grossSalary: 0, netSalary: 0, employerCost: 0 });

    return {
      format: JEEVES_CONFIG.formatVersion,
      mappingVerified: JEEVES_CONFIG.verified,
      generatedAt: new Date().toISOString(),
      market: m.code,
      currency: m.currency,
      legalEntity: m.entity.legalName,
      registrationNumber: m.entity.regNumber,
      rowCount: rows.length,
      totals: {
        invoiceAmount: IB.round2(totals.invoiceAmount),
        grossSalary: IB.round2(totals.grossSalary),
        employerCost: IB.round2(totals.employerCost),
        netSalary: IB.round2(totals.netSalary)
      },
      rows
    };
  }

  /* Flat CSV for the file-drop route, which is how most Jeeves installations
     ingest payroll batches today. Semicolon-separated, which is what Danish
     and Norwegian Excel expects. */
  function toJeevesCSV(assignments, market) {
    const payload = toJeeves(assignments, market);
    if (!payload.rows.length) return '';
    const cols = Object.keys(payload.rows[0]);
    const esc = v => {
      const s = String(v === null || v === undefined ? '' : v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(';')];
    payload.rows.forEach(r => lines.push(cols.map(c => esc(r[c])).join(';')));
    return '﻿' + lines.join('\r\n') + '\r\n';   // BOM so Excel reads UTF-8
  }

  /* Deliberately a stub. It assembles and sanity-checks the payload and
     reports what it WOULD send; it does not guess an endpoint contract.
     Wire this up once the Jeeves integration spec exists. */
  async function sendToJeeves(assignments, market) {
    const payload = toJeeves(assignments, market);
    if (!payload.rowCount) return { ok: false, reason: 'EMPTY' };
    if (!JEEVES_CONFIG.endpoint) {
      return { ok: false, reason: 'NO_ENDPOINT', payload };
    }
    if (!JEEVES_CONFIG.verified) {
      return { ok: false, reason: 'MAPPING_UNVERIFIED', payload };
    }
    return { ok: false, reason: 'NOT_IMPLEMENTED', payload };
  }

  /* ═══════════════════ TEMPLATE ═══════════════════
     A CSV the user can open in Excel, fill in and upload back. CSV rather
     than xlsx keeps this dependency-free in both directions; Excel opens it
     natively and will save it back as .xlsx if they prefer. */
  function templateCSV(scope, lang) {
    const t = k => (global.IBi18n ? global.IBi18n.t(k, lang) : k);
    const cols = [];
    if (scope === 'admin') cols.push(t('import.col.companyEmail'));
    cols.push(t('import.col.consultantEmail'), t('import.col.period'),
              t('import.col.description'), t('import.col.hours'),
              t('import.col.hourlyRate'), t('import.col.type'));
    const example = [];
    if (scope === 'admin') example.push(lang === 'da' ? 'info@virksomhed.dk' : 'info@bedrift.no');
    example.push(lang === 'da' ? 'sara@konsulent.dk' : 'sara@konsulent.no',
                 lang === 'da' ? 'Maj 2026' : 'Mai 2026',
                 lang === 'da' ? 'Eventkoordinering' : 'Arrangementskoordinering',
                 '37,5', lang === 'da' ? '520' : '790', 'SalaryInvoicing');
    return '﻿' + cols.join(';') + '\r\n' + example.join(';') + '\r\n';
  }

  const API = {
    COLUMNS, LIMITS, JEEVES_CONFIG,
    norm, toNumber, mapColumns, validate, commit,
    toJeeves, toJeevesCSV, sendToJeeves, jeevesRows, templateCSV
  };

  global.IBImport = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
