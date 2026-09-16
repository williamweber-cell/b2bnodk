/* ═══════════════════════════════════════════════════════════════════════════
   ib-core.js — shared domain core for Invoicery Business

   Loaded as a CLASSIC script (not an ES module) so opening the HTML files
   directly from disk (file://) keeps working. Also exports under CommonJS so
   .cjs check scripts can require() it.

   Depends on ib-markets.js and ib-i18n.js — load those first.

   THIS FILE IS AUTHORITATIVE for:
     - storage access and key names
     - demo seed data
     - market-aware money and date formatting
     - HTML escaping
     - status and type constants

   Statutory rates and the payroll calculations live in ib-markets.js,
   because they differ per market. Translations live in ib-i18n.js.

   ── SCHEMA IS LANGUAGE-NEUTRAL ──
   Field names are English. The product ships in Danish and Norwegian; a
   two-market data model must not be written in either market's language
   (or, as it was, in the language of a market we no longer serve). UI
   strings are translated; the schema is not.

   ── STORAGE IS MARKET-SCOPED ──
   Denmark and Norway are separate legal entities with separate books, so
   they get separate data: IB_DK_* and IB_NO_*. Switching market switches
   the whole dataset. Nothing is shared across markets except the selected
   market itself.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var Markets = global.IBMarkets || (typeof require === 'function' ? require('./ib-markets.js') : null);
  var i18n = global.IBi18n || (typeof require === 'function' ? require('./ib-i18n.js') : null);

  /* ═══════════════════ STATUS & TYPE ═══════════════════
     Language-neutral keys. These are persisted and compared by equality, so
     they must never carry locale-specific spelling. The display label comes
     from i18n: t('status.' + status). */
  var STATUS = {
    DRAFT:    'draft',
    PENDING:  'pending',
    APPROVED: 'approved',
    PAID:     'paid',
    REJECTED: 'rejected'
  };

  var TYPE = {
    SALARY_INVOICING:     'SalaryInvoicing',
    EXCEL_IMPORT:         'Excel-import',
    API_INTEGRATION:      'API-integration',
    WORKFORCE_MANAGEMENT: 'Workforce Management'
  };

  var SEED_VERSION = '4';

  /* ═══════════════════ MARKET ═══════════════════ */
  function market()        { return Markets.current(); }
  function marketCode()    { return market().code; }
  function setMarket(code) {
    if (!Markets.setCurrent(code)) return false;
    syncLang();
    return true;
  }
  function syncLang() {
    if (i18n) i18n.setLang(market().lang);
  }
  function t(key) { return i18n ? i18n.t(key) : key; }

  /* ═══════════════════ STORAGE ═══════════════════
     Keys are namespaced per market: IB_DK_USERS, IB_NO_ASSIGNMENTS, … */
  function key(name, code) {
    return 'IB_' + (code || marketCode()) + '_' + name;
  }
  function keys(code) {
    return {
      users:       key('USERS', code),
      assignments: key('ASSIGNMENTS', code),
      session:     key('SESSION', code),
      seeded:      key('SEEDED', code)
    };
  }

  function DB(k) {
    try { return JSON.parse(global.localStorage.getItem(k) || 'null'); }
    catch (e) { return null; }
  }
  function DBs(k, v) {
    try { global.localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { /* quota or private mode — fail soft */ }
  }

  function getUsers(code)          { return DB(key('USERS', code)) || []; }
  function getAssignments(code)    { return DB(key('ASSIGNMENTS', code)) || []; }
  function saveUsers(a, code)      { DBs(key('USERS', code), a); }
  function saveAssignments(a, code){ DBs(key('ASSIGNMENTS', code), a); }
  function getSession(code)        { return DB(key('SESSION', code)); }
  function saveSession(u, code)    { DBs(key('SESSION', code), u); }
  function clearSession(code) {
    try { global.localStorage.removeItem(key('SESSION', code)); } catch (e) {}
  }

  /* ═══════════════════ SEED ═══════════════════
     One dataset per market, with that market's own companies, registration
     number format and currency scale. Amounts are not a straight conversion
     — they are plausible local rates, because a demo that shows Danish
     hourly rates converted from Swedish ones looks wrong to a Danish buyer. */

  var SEED = {
    DK: {
      users: [
        { id: 'U1', email: 'admin@invoicerybusiness.dk', password: 'admin123',
          role: 'admin', name: 'Anne Lindström' },
        { id: 'U2', email: 'sara@konsulent.dk', password: 'klient123', role: 'consultant',
          name: 'Sara Bergström', phone: '+45 20 12 34 56',
          street: 'Nørrebrogade 42, 3. th', zip: '2200', city: 'København',
          country: 'Danmark', personalId: '150390-9999',
          bankAccount: '1234-0009999999', employmentType: 'hourly',
          taxCard: 'hovedkort', taxRate: 38,
          status: 'active', joined: '2025-11-15' },
        { id: 'U3', email: 'erik@konsulent.dk', password: 'klient123', role: 'consultant',
          name: 'Erik Johansen', phone: '+45 31 98 76 54',
          street: 'Banegårdspladsen 7', zip: '8000', city: 'Aarhus',
          country: 'Danmark', personalId: '220785-9999',
          bankAccount: '5678-0009999888', employmentType: 'hourly',
          taxCard: 'bikort', taxRate: 55,
          status: 'active', joined: '2026-01-08' },
        { id: 'U4', email: 'info@virksomhed.dk', password: 'kund123', role: 'company',
          name: 'Lides Event A/S', contactName: 'Maria Lide', regNumber: '12345678',
          status: 'active', joined: '2025-10-01' },
        { id: 'U5', email: 'hr@prisjakt.dk', password: 'kund123', role: 'company',
          name: 'Prisjakt Danmark A/S', contactName: 'Jonas Svensson', regNumber: '87654321',
          status: 'active', joined: '2025-12-20' }
      ],
      assignments: [
        { id: 'OPG-2026-001', consultantId: 'U2', consultantName: 'Sara Bergström',
          companyId: 'U4', companyName: 'Lides Event A/S', type: 'SalaryInvoicing',
          description: 'Koordinering og logistik til arrangementer april 2026',
          hours: 40, hourlyRate: 520, amount: 20800, period: 'April 2026',
          status: 'approved', createdDate: '2026-04-01', approvedDate: '2026-04-03', adminNote: '' },
        { id: 'OPG-2026-002', consultantId: 'U2', consultantName: 'Sara Bergström',
          companyId: 'U5', companyName: 'Prisjakt Danmark A/S', type: 'SalaryInvoicing',
          description: 'Frontend-udvikling og UX-analyse',
          hours: 32, hourlyRate: 610, amount: 19520, period: 'April 2026',
          status: 'pending', createdDate: '2026-04-05', approvedDate: '', adminNote: '' },
        { id: 'OPG-2026-003', consultantId: 'U3', consultantName: 'Erik Johansen',
          companyId: 'U4', companyName: 'Lides Event A/S', type: 'Excel-import',
          description: 'Teknisk support og rigning',
          hours: 24, hourlyRate: 455, amount: 10920, period: 'April 2026',
          status: 'pending', createdDate: '2026-04-06', approvedDate: '', adminNote: '' },
        { id: 'OPG-2026-004', consultantId: 'U2', consultantName: 'Sara Bergström',
          companyId: 'U4', companyName: 'Lides Event A/S', type: 'SalaryInvoicing',
          description: 'Projektledelse Q1 2026',
          hours: 60, hourlyRate: 550, amount: 33000, period: 'Marts 2026',
          status: 'paid', createdDate: '2026-03-01', approvedDate: '2026-03-04',
          adminNote: 'Lønkørt 2026-03-15' }
      ]
    },

    NO: {
      users: [
        { id: 'U1', email: 'admin@invoicerybusiness.no', password: 'admin123',
          role: 'admin', name: 'Anne Lindström' },
        { id: 'U2', email: 'sara@konsulent.no', password: 'klient123', role: 'consultant',
          name: 'Sara Bergström', phone: '+47 400 12 345',
          street: 'Storgata 18B', zip: '0184', city: 'Oslo',
          country: 'Norge', personalId: '15039099999',
          bankAccount: '12345699999', employmentType: 'hourly',
          taxCard: 'tabelltrekk', taxTable: '7100', taxMunicipality: 'Oslo',
          status: 'active', joined: '2025-11-15' },
        { id: 'U3', email: 'erik@konsulent.no', password: 'klient123', role: 'consultant',
          name: 'Erik Johansen', phone: '+47 900 98 765',
          street: 'Bryggen 11', zip: '5003', city: 'Bergen',
          country: 'Norge', personalId: '22078599999',
          bankAccount: '98765499999', employmentType: 'hourly',
          taxCard: 'prosenttrekk', taxRate: 32, taxMunicipality: 'Bergen',
          status: 'active', joined: '2026-01-08' },
        { id: 'U4', email: 'info@bedrift.no', password: 'kund123', role: 'company',
          name: 'Lides Event AS', contactName: 'Maria Lide', regNumber: '912 345 678',
          status: 'active', joined: '2025-10-01' },
        { id: 'U5', email: 'hr@prisjakt.no', password: 'kund123', role: 'company',
          name: 'Prisjakt Norge AS', contactName: 'Jonas Svensson', regNumber: '987 654 321',
          status: 'active', joined: '2025-12-20' }
      ],
      assignments: [
        { id: 'OPP-2026-001', consultantId: 'U2', consultantName: 'Sara Bergström',
          companyId: 'U4', companyName: 'Lides Event AS', type: 'SalaryInvoicing',
          description: 'Koordinering og logistikk for arrangementer april 2026',
          hours: 40, hourlyRate: 790, amount: 31600, period: 'April 2026',
          status: 'approved', createdDate: '2026-04-01', approvedDate: '2026-04-03', adminNote: '' },
        { id: 'OPP-2026-002', consultantId: 'U2', consultantName: 'Sara Bergström',
          companyId: 'U5', companyName: 'Prisjakt Norge AS', type: 'SalaryInvoicing',
          description: 'Frontend-utvikling og UX-analyse',
          hours: 32, hourlyRate: 890, amount: 28480, period: 'April 2026',
          status: 'pending', createdDate: '2026-04-05', approvedDate: '', adminNote: '' },
        { id: 'OPP-2026-003', consultantId: 'U3', consultantName: 'Erik Johansen',
          companyId: 'U4', companyName: 'Lides Event AS', type: 'Excel-import',
          description: 'Teknisk støtte og rigging',
          hours: 24, hourlyRate: 680, amount: 16320, period: 'April 2026',
          status: 'pending', createdDate: '2026-04-06', approvedDate: '', adminNote: '' },
        { id: 'OPP-2026-004', consultantId: 'U2', consultantName: 'Sara Bergström',
          companyId: 'U4', companyName: 'Lides Event AS', type: 'SalaryInvoicing',
          description: 'Prosjektledelse Q1 2026',
          hours: 60, hourlyRate: 830, amount: 49800, period: 'Mars 2026',
          status: 'paid', createdDate: '2026-03-01', approvedDate: '2026-03-04',
          adminNote: 'Lønnskjørt 2026-03-15' }
      ]
    }
  };

  function seedUsers(code)       { return clone(SEED[code || marketCode()].users); }
  function seedAssignments(code) { return clone(SEED[code || marketCode()].assignments); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* Seed one market. Called for every market on boot so switching markets
     never lands on an empty dataset. */
  function seed(code, force) {
    var c = code || marketCode();
    if (!force && DB(key('SEEDED', c)) === SEED_VERSION) return false;
    DBs(key('USERS', c), seedUsers(c));
    DBs(key('ASSIGNMENTS', c), seedAssignments(c));
    DBs(key('SEEDED', c), SEED_VERSION);
    return true;
  }

  function seedAll(force) {
    return Object.keys(SEED).map(function (c) { return seed(c, force); });
  }

  /* Wipe every IB_* key for one market (or all) and reseed. */
  function resetDemo(code) {
    var codes = code ? [code] : Object.keys(SEED);
    codes.forEach(function (c) {
      var k = keys(c);
      Object.keys(k).forEach(function (n) {
        try { global.localStorage.removeItem(k[n]); } catch (e) {}
      });
      seed(c, true);
    });
  }

  /* ═══════════════════ IDENTIFIERS ═══════════════════
     Prefix is market-specific: OPG (opgave) in Denmark, OPP (oppdrag) in
     Norway. Sequence derives from the highest existing number, not the list
     length, which collided after any removal. */
  var ID_PREFIX = { DK: 'OPG', NO: 'OPP' };

  function nextAssignmentId(list, code, year) {
    var c = code || marketCode();
    var y = year || new Date().getFullYear();
    var prefix = (ID_PREFIX[c] || 'ASG') + '-' + y + '-';
    var max = 0;
    (list || []).forEach(function (a) {
      if (typeof a.id === 'string' && a.id.indexOf(prefix) === 0) {
        var n = parseInt(a.id.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return prefix + String(max + 1).padStart(3, '0');
  }

  function invoiceNumber(seq, code, year) {
    var c = code || marketCode();
    var y = year || new Date().getFullYear();
    return 'IB' + c + '-' + y + '-' + String(seq).padStart(3, '0');
  }

  /* ═══════════════════ PAYROLL ═══════════════════
     Delegates to the current market's model. Views never compute money. */
  function calcPayroll(amount, opts) {
    return Markets.calcPayroll(amount, market(), opts);
  }
  function calcPayrollBatch(list, opts) {
    return Markets.calcPayrollBatch(list, market(), opts);
  }

  /* ═══════════════════ FORMATTING ═══════════════════
     Market-aware. Display-time rounding only — never feed a formatted value
     back into a calculation. */
  function fmt(n) {
    var m = market();
    return Number(n).toLocaleString(m.locale, {
      style: 'currency', currency: m.currency, maximumFractionDigits: 0
    });
  }
  function fmtN(n) {
    var m = market();
    return Number(n).toLocaleString(m.locale, { maximumFractionDigits: 0 }) +
           ' ' + m.currencySymbol;
  }
  function fmtPct(n, decimals) {
    var m = market();
    return Number(n * 100).toLocaleString(m.locale, {
      minimumFractionDigits: decimals === undefined ? 1 : decimals,
      maximumFractionDigits: decimals === undefined ? 2 : decimals
    }) + ' %';
  }
  function fmtDate(d) {
    if (!d) return '';
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString(market().locale);
  }
  function fmtDateLong(d) {
    var dt = d ? new Date(d) : new Date();
    return dt.toLocaleDateString(market().locale,
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function round2(n) { return Math.round(Number(n) * 100) / 100; }

  /* ═══════════════════ HTML ESCAPING ═══════════════════
     Every view builds markup with template strings and assigns via
     innerHTML. Any value that originated from a user — description, names,
     emails, adminNote, period — MUST pass through esc() first, including
     inside onclick="fn('${...}')" attributes. */
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  /* ═══════════════════ EXPORT ═══════════════════ */
  var IB = {
    STATUS: STATUS,
    TYPE: TYPE,
    SEED_VERSION: SEED_VERSION,
    SEED: SEED,
    ID_PREFIX: ID_PREFIX,

    market: market, marketCode: marketCode, setMarket: setMarket,
    syncLang: syncLang, t: t,

    key: key, keys: keys, DB: DB, DBs: DBs,
    getUsers: getUsers, getAssignments: getAssignments,
    saveUsers: saveUsers, saveAssignments: saveAssignments,
    getSession: getSession, saveSession: saveSession, clearSession: clearSession,

    seed: seed, seedAll: seedAll, resetDemo: resetDemo,
    seedUsers: seedUsers, seedAssignments: seedAssignments,

    nextAssignmentId: nextAssignmentId, invoiceNumber: invoiceNumber,

    calcPayroll: calcPayroll, calcPayrollBatch: calcPayrollBatch,

    fmt: fmt, fmtN: fmtN, fmtPct: fmtPct,
    fmtDate: fmtDate, fmtDateLong: fmtDateLong,
    today: today, round2: round2,
    esc: esc
  };

  global.IB = IB;
  if (typeof module !== 'undefined' && module.exports) module.exports = IB;

})(typeof window !== 'undefined' ? window : globalThis);
