/* ═══════════════════════════════════════════════════════════════════════════
   ib-core.js — shared domain core for Invoicery Business

   Loaded as a CLASSIC script (not an ES module) so that opening the HTML
   files directly from disk (file://) keeps working — ES modules are blocked
   by CORS on file:// and that would break local demos.

   Also exports under CommonJS so .cjs test/check scripts can require() it.

   THIS FILE IS AUTHORITATIVE for:
     - localStorage access and key names
     - demo seed data
     - every statutory rate and every payroll calculation
     - money formatting
     - HTML escaping

   Never re-derive a rate or a calculation in a view. Import it from here.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ═══════════════════ STATUTORY RATES ═══════════════════
     Swedish rates, 2026. Single source of truth — changing a number here
     changes it everywhere in both applications.

     NOTE: arbetsgivaravgift and preliminarskatt are simplified flat rates.
     Production needs per-consultant resolution:
       - arbetsgivaravgift is reduced for employees born 2003+ (ungdom) and
         for those who turned 66 before the income year began
       - preliminarskatt comes from the individual's skattetabell /
         jamkningsbeslut, not a flat 32%
     See RATE_NOTES below. */
  var RATES = {
    serviceavgift:     0.06,    // Invoicery Business service fee
    arbetsgivaravgift: 0.3142,  // Full rate, 2026
    preliminarskatt:   0.32,    // Flat approximation — see note above
    moms:              0.25     // Swedish standard VAT
  };

  var RATE_NOTES = {
    serviceavgift:     'Commercial rate, configurable per agreement in admin settings.',
    arbetsgivaravgift: 'Full rate 31,42%. Reduced brackets exist for ungdom and 66+.',
    preliminarskatt:   'Flat approximation. Real tax comes from skattetabell per consultant.',
    moms:              'Standard rate. Some services qualify for 12% or 6%.'
  };

  /* ═══════════════════ PAYROLL ═══════════════════

     THE CALCULATION, derived once:

       fakturabelopp    = timmar x timlon              (excl. moms)
       moms             = fakturabelopp x 0,25
       fakturatotal     = fakturabelopp + moms          (what the client pays)

       serviceavgift    = fakturabelopp x 0,06
       lonebas          = fakturabelopp - serviceavgift (employer's pot)

       Arbetsgivaravgift is levied ON TOP of the gross salary, it is not a
       slice of the pot. So the gross salary must be backed OUT of the pot:

           lonebas = bruttolon + (bruttolon x 0,3142)
                   = bruttolon x 1,3142
       =>  bruttolon = lonebas / 1,3142

       arbetsgivaravgift = lonebas - bruttolon
       preliminarskatt   = bruttolon x 0,32
       nettolon          = bruttolon - preliminarskatt

     This is why `lonebas x (1 - 0,3142)` is WRONG — it understates the
     employer cost base and therefore understates the consultant's salary.

     All values are returned as exact floats. Round at DISPLAY time only
     (see fmtN / fmt); rounding mid-chain causes ore drift that compounds
     across a full lonekorning. */
  function calcPayroll(fakturabelopp, opts) {
    var o = opts || {};
    var rServ = typeof o.serviceavgift === 'number' ? o.serviceavgift : RATES.serviceavgift;
    var rAgv  = typeof o.arbetsgivaravgift === 'number' ? o.arbetsgivaravgift : RATES.arbetsgivaravgift;
    var rTax  = typeof o.preliminarskatt === 'number' ? o.preliminarskatt : RATES.preliminarskatt;
    var rMoms = typeof o.moms === 'number' ? o.moms : RATES.moms;

    var belopp = Number(fakturabelopp) || 0;

    var moms          = belopp * rMoms;
    var fakturatotal  = belopp + moms;

    var serviceavgift = belopp * rServ;
    var lonebas       = belopp - serviceavgift;

    var bruttolon         = lonebas / (1 + rAgv);
    var arbetsgivaravgift = lonebas - bruttolon;

    var preliminarskatt = bruttolon * rTax;
    var nettolon        = bruttolon - preliminarskatt;

    return {
      fakturabelopp:     belopp,
      moms:              moms,
      fakturatotal:      fakturatotal,
      serviceavgift:     serviceavgift,
      lonebas:           lonebas,
      bruttolon:         bruttolon,
      arbetsgivaravgift: arbetsgivaravgift,
      preliminarskatt:   preliminarskatt,
      nettolon:          nettolon
    };
  }

  /* Aggregate a set of uppdrag into one lonekorning summary. */
  function calcPayrollBatch(uppdragList, opts) {
    var sum = {
      antal: 0, fakturabelopp: 0, moms: 0, fakturatotal: 0,
      serviceavgift: 0, lonebas: 0, bruttolon: 0,
      arbetsgivaravgift: 0, preliminarskatt: 0, nettolon: 0
    };
    (uppdragList || []).forEach(function (u) {
      var p = calcPayroll(u.belopp, opts);
      sum.antal += 1;
      Object.keys(p).forEach(function (k) { sum[k] += p[k]; });
    });
    return sum;
  }

  /* ═══════════════════ STORAGE ═══════════════════ */
  var KEYS = {
    users:    'IB_USERS',
    uppdrag:  'IB_UPPDRAG',
    foretag:  'IB_FORETAG',
    session:  'IB_SESSION',
    seeded:   'IB_SEEDED'
  };

  /* Bump when the shape of seeded data changes, so an old seed in a
     returning browser is replaced instead of silently kept. */
  var SEED_VERSION = '2';

  function DB(k) {
    try { return JSON.parse(global.localStorage.getItem(k) || 'null'); }
    catch (e) { return null; }
  }
  function DBs(k, v) {
    try { global.localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { /* quota or private mode — fail soft */ }
  }

  function getUsers()      { return DB(KEYS.users) || []; }
  function getUppdrag()    { return DB(KEYS.uppdrag) || []; }
  function getForetag()    { return DB(KEYS.foretag) || []; }
  function saveUsers(a)    { DBs(KEYS.users, a); }
  function saveUppdrag(a)  { DBs(KEYS.uppdrag, a); }
  function saveForetag(a)  { DBs(KEYS.foretag, a); }

  /* ═══════════════════ SEED ═══════════════════
     Previously duplicated in both HTML files with DIFFERENT user records,
     while both guarded on the same IB_SEEDED key. Whichever app you opened
     first won, so the admin konsult register could show blank phone/city.
     This is the merged union of both variants. */
  function seedUsers() {
    return [
      { id: 'U1', email: 'admin@invoicerybusiness.se', password: 'admin123', role: 'admin',
        name: 'Anna Lindström' },
      { id: 'U2', email: 'sara@konsult.se', password: 'klient123', role: 'konsult',
        name: 'Sara Bergström', orgNr: '', phone: '+46 70 123 45 67',
        city: 'Stockholm', status: 'active', joined: '2025-11-15' },
      { id: 'U3', email: 'erik@konsult.se', password: 'klient123', role: 'konsult',
        name: 'Erik Johansson', orgNr: '', phone: '+46 73 987 65 43',
        city: 'Göteborg', status: 'active', joined: '2026-01-08' },
      { id: 'U4', email: 'info@foretag.se', password: 'kund123', role: 'foretag',
        name: 'Lides Event AB', contactName: 'Maria Lide', orgNr: '559123-4567',
        status: 'active', joined: '2025-10-01' },
      { id: 'U5', email: 'hr@prisjakt.se', password: 'kund123', role: 'foretag',
        name: 'Prisjakt Sverige AB', contactName: 'Jonas Svensson', orgNr: '556789-0123',
        status: 'active', joined: '2025-12-20' }
    ];
  }

  function seedUppdrag() {
    return [
      { id: 'UPP-2026-001', konsultId: 'U2', konsultName: 'Sara Bergström',
        foretagId: 'U4', foretagName: 'Lides Event AB', typ: 'SalaryInvoicing',
        beskrivning: 'Koordination och logistik för evenemang april 2026',
        timmar: 40, timlön: 680, belopp: 27200, period: 'April 2026',
        status: 'godkänt', skapadDatum: '2026-04-01', godkändDatum: '2026-04-03', adminNote: '' },
      { id: 'UPP-2026-002', konsultId: 'U2', konsultName: 'Sara Bergström',
        foretagId: 'U5', foretagName: 'Prisjakt Sverige AB', typ: 'SalaryInvoicing',
        beskrivning: 'Frontend-utveckling och UX-analys',
        timmar: 32, timlön: 780, belopp: 24960, period: 'April 2026',
        status: 'väntar_godkännande', skapadDatum: '2026-04-05', godkändDatum: '', adminNote: '' },
      { id: 'UPP-2026-003', konsultId: 'U3', konsultName: 'Erik Johansson',
        foretagId: 'U4', foretagName: 'Lides Event AB', typ: 'Excel-import',
        beskrivning: 'Teknisk support och riggning',
        timmar: 24, timlön: 590, belopp: 14160, period: 'April 2026',
        status: 'väntar_godkännande', skapadDatum: '2026-04-06', godkändDatum: '', adminNote: '' },
      { id: 'UPP-2026-004', konsultId: 'U2', konsultName: 'Sara Bergström',
        foretagId: 'U4', foretagName: 'Lides Event AB', typ: 'SalaryInvoicing',
        beskrivning: 'Projektledning Q1 2026',
        timmar: 60, timlön: 720, belopp: 43200, period: 'Mars 2026',
        status: 'utbetalt', skapadDatum: '2026-03-01', godkändDatum: '2026-03-04',
        adminNote: 'Lönekörd 2026-03-15' }
    ];
  }

  function seed(force) {
    if (!force && DB(KEYS.seeded) === SEED_VERSION) return false;
    DBs(KEYS.users, seedUsers());
    DBs(KEYS.uppdrag, seedUppdrag());
    DBs(KEYS.seeded, SEED_VERSION);
    return true;
  }

  /* Wipe every IB_* key and reseed. Used by the demo-reset command. */
  function resetDemo() {
    Object.keys(KEYS).forEach(function (k) {
      try { global.localStorage.removeItem(KEYS[k]); } catch (e) {}
    });
    seed(true);
  }

  /* ═══════════════════ IDENTIFIERS ═══════════════════
     Replaces 'UPP-2026-' + (list.length + 5), which hardcoded the year and
     collided as soon as anything was removed from the list. */
  function nextUppdragId(uppdragList, year) {
    var y = year || new Date().getFullYear();
    var prefix = 'UPP-' + y + '-';
    var max = 0;
    (uppdragList || []).forEach(function (u) {
      if (typeof u.id === 'string' && u.id.indexOf(prefix) === 0) {
        var n = parseInt(u.id.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return prefix + String(max + 1).padStart(3, '0');
  }

  /* ═══════════════════ FORMATTING ═══════════════════
     Display-time rounding only. Never feed a formatted value back into a
     calculation. */
  function fmt(n) {
    return Number(n).toLocaleString('sv-SE', {
      style: 'currency', currency: 'SEK', maximumFractionDigits: 0
    });
  }
  function fmtN(n) {
    return Number(n).toLocaleString('sv-SE', { maximumFractionDigits: 0 }) + ' kr';
  }
  function fmtDate(d) {
    if (!d) return '';
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString('sv-SE');
  }
  function today() {
    return new Date().toISOString().slice(0, 10);
  }
  /* Round to ore. For comparisons and assertions, not for display. */
  function round2(n) { return Math.round(Number(n) * 100) / 100; }

  /* ═══════════════════ HTML ESCAPING ═══════════════════
     Every view builds markup with template strings and assigns via
     innerHTML. Any value that originated from a user — beskrivning, names,
     emails, adminNote, period — MUST pass through esc() first, or a
     consultant can script the foretag's approval screen and the admin
     dashboard by typing into a form field. */
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  /* ═══════════════════ STATUS ═══════════════════
     Canonical status values. Note the diacritics — these strings are
     persisted in localStorage and compared by equality, so a lookalike
     character silently breaks every filter. */
  var STATUS = {
    UTKAST:   'utkast',
    VANTAR:   'väntar_godkännande',
    GODKANT:  'godkänt',
    UTBETALT: 'utbetalt',
    AVVISAT:  'avvisat'
  };

  var TYP = {
    SALARY_INVOICING:     'SalaryInvoicing',
    EXCEL_IMPORT:         'Excel-import',
    API_INTEGRATION:      'API-integration',
    WORKFORCE_MANAGEMENT: 'Workforce Management'
  };

  /* ═══════════════════ EXPORT ═══════════════════ */
  var IB = {
    RATES: RATES,
    RATE_NOTES: RATE_NOTES,
    KEYS: KEYS,
    SEED_VERSION: SEED_VERSION,
    STATUS: STATUS,
    TYP: TYP,

    calcPayroll: calcPayroll,
    calcPayrollBatch: calcPayrollBatch,

    DB: DB, DBs: DBs,
    getUsers: getUsers, getUppdrag: getUppdrag, getForetag: getForetag,
    saveUsers: saveUsers, saveUppdrag: saveUppdrag, saveForetag: saveForetag,

    seed: seed, seedUsers: seedUsers, seedUppdrag: seedUppdrag, resetDemo: resetDemo,
    nextUppdragId: nextUppdragId,

    fmt: fmt, fmtN: fmtN, fmtDate: fmtDate, today: today, round2: round2,
    esc: esc
  };

  global.IB = IB;
  if (typeof module !== 'undefined' && module.exports) module.exports = IB;

})(typeof window !== 'undefined' ? window : globalThis);
