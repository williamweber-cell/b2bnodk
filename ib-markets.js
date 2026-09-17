/* ═══════════════════════════════════════════════════════════════════════════
   ib-markets.js — market registry for Invoicery Business

   Two markets: Denmark and Norway. Each carries its own legal entity,
   currency, locale, statutory rates and — importantly — its own PAYROLL
   MODEL. Denmark and Norway do not differ only in numbers; the calculation
   chain itself has a different shape. See PAYROLL MODELS below.

   ┌───────────────────────────────────────────────────────────────────────┐
   │  RATES ARE UNVERIFIED.                                                │
   │                                                                       │
   │  Every rate in this file is marked `verified: false`. They are        │
   │  plausible current values used to build and test the calculation      │
   │  structure. They have NOT been confirmed against Skatteetaten,        │
   │  Skattestyrelsen, ATP or your own payroll operation.                  │
   │                                                                       │
   │  The STRUCTURE is the deliverable. The NUMBERS need your Danish and   │
   │  Norwegian payroll people to sign off before any of this is quoted    │
   │  to a customer. Flip `verified` to true per market once they have.    │
   └───────────────────────────────────────────────────────────────────────┘
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ═══════════════════ PAYROLL MODELS ═══════════════════

     ── NORWAY ── model: 'no'

       fakturabeløp  (eks. mva)
       − servicegebyr                     6 %
       = lønnsbase                        the employer's pot

       The pot must cover gross salary, the feriepenger accrued on it, AND
       arbeidsgiveravgift levied on both:

           lønnsbase = brutto·(1+f)·(1+a)
       ⇒   brutto    = lønnsbase / ((1+f)(1+a))

       feriepenger       = brutto × 10,2 %      accrued, paid the year after
       arbeidsgiveravgift= (brutto + feriepenger) × 14,1 %
       forskuddstrekk    = brutto × 32 %
       nettolønn         = brutto − forskuddstrekk

     ── DENMARK ── model: 'dk'

       Structurally different. There is no large employer percentage like
       arbeidsgiveravgift. Instead ATP is a fixed krone amount, and
       AM-bidrag is an EMPLOYEE deduction taken before A-skat.

       fakturabeløb  (ekskl. moms)
       − servicegebyr                     6 %
       = lønbase

       Employer side:
           lønbase − ATP(arbejdsgiver) = brutto·(1 + ferie + øvrige)
       ⇒   brutto = (lønbase − ATP_ag) / (1 + 0,125 + 0,015)

       Employee side — note the ORDER, this is the distinctive part:
           ATP(lønmodtager)  fixed krone amount, off gross
           AM-bidrag         8 % of (brutto − ATP_lm)
           A-skat            38 % of (brutto − ATP_lm − AM-bidrag)
           nettoløn          = brutto − ATP_lm − AM-bidrag − A-skat

       ATP is a fixed monthly amount, not a percentage, so it is pro-rated
       against a full-time month (160,33 h). An uppgave covering 40 h in a
       month carries roughly a quarter of the monthly ATP.                  */

  var MARKETS = {

    /* ═══════════════════ DENMARK ═══════════════════ */
    DK: {
      code: 'DK',
      name: 'Danmark',
      lang: 'da',
      locale: 'da-DK',
      currency: 'DKK',
      currencySymbol: 'kr.',
      flag: '🇩🇰',
      flagSVG: '<svg viewBox="0 0 37 28" aria-hidden="true" focusable="false"><rect width="37" height="28" fill="#C8102E"/><rect x="12" width="4" height="28" fill="#fff"/><rect y="12" width="37" height="4" fill="#fff"/></svg>',
      model: 'dk',
      verified: false,

      entity: {
        legalName: 'Invoicery Business A/S',
        regLabel: 'CVR-nr.',
        personIdLabel: 'CPR-nummer',
        regNumber: '00000000',          // ← fill in
        vatLabel: 'SE-nr.',
        vatNumber: 'DK00000000',        // ← fill in
        address: 'Adresse 1, 1000 København', // ← fill in
        bankLabel: 'Bankkonto',
        bankAccount: '0000-0000000000', // ← fill in
        email: 'kontakt@invoicerybusiness.dk',
        phone: '+45 00 00 00 00'
      },

      rates: {
        serviceFee:    0.06,    // servicegebyr
        holiday:       0.125,   // feriegodtgørelse, timelønnede
        otherEmployer: 0.015,   // AUB/AER, AES, barsel.dk, finansieringsbidrag
        amContribution:0.08,    // AM-bidrag (employee)
        withholding:   0.38,    // A-skat, trækprocent
        vat:           0.25     // moms
      },

      fixed: {
        atpEmployerMonthly: 189.35,  // DKK, arbejdsgiverandel
        atpEmployeeMonthly:  94.65,  // DKK, lønmodtagerandel
        fullTimeMonthHours: 160.33
      },

      rateNotes: {
        serviceFee:    'Commercial rate, per agreement.',
        holiday:       'Feriegodtgørelse 12,5 % for timelønnede. Fastansatte med betalt ferie optjener 2,08 dage/md i stedet.',
        otherEmployer: 'Bundled estimate for AUB/AER, AES, barsel.dk and finansieringsbidrag. Split these out before production.',
        amContribution:'AM-bidrag 8 %, deducted from the employee before A-skat.',
        withholding:   'Flat approximation. Real A-skat comes from the employee\'s trækprocent and fradrag on their skattekort.',
        vat:           'Standard moms.',
        atp:           'ATP full rate. Hourly workers use A-sats by hours worked; this pro-rates against a full-time month instead.'
      },

      // Purposes offered for the employment certificate.
      certificatePurposes: ['Låneansøgning', 'Boligansøgning', 'A-kasse', 'Andet']
    },

    /* ═══════════════════ NORWAY ═══════════════════ */
    NO: {
      code: 'NO',
      name: 'Norge',
      lang: 'nb',
      locale: 'nb-NO',
      currency: 'NOK',
      currencySymbol: 'kr',
      flag: '🇳🇴',
      flagSVG: '<svg viewBox="0 0 22 16" aria-hidden="true" focusable="false"><rect width="22" height="16" fill="#BA0C2F"/><rect x="6" width="4" height="16" fill="#fff"/><rect y="6" width="22" height="4" fill="#fff"/><rect x="7" width="2" height="16" fill="#00205B"/><rect y="7" width="22" height="2" fill="#00205B"/></svg>',
      model: 'no',
      verified: false,

      entity: {
        legalName: 'Invoicery Business AS',
        regLabel: 'Org.nr.',
        personIdLabel: 'Fødselsnummer',
        regNumber: '000 000 000',       // ← fill in
        vatLabel: 'MVA-nr.',
        vatNumber: 'NO000000000MVA',    // ← fill in
        address: 'Adresse 1, 0000 Oslo', // ← fill in
        bankLabel: 'Bankkonto',
        bankAccount: '0000.00.00000',   // ← fill in
        email: 'kontakt@invoicerybusiness.no',
        phone: '+47 00 00 00 00'
      },

      rates: {
        serviceFee:  0.06,    // servicegebyr
        holiday:     0.102,   // feriepenger, 4 uker + 1 dag
        employerTax: 0.141,   // arbeidsgiveravgift, sone 1
        withholding: 0.32,    // forskuddstrekk
        vat:         0.25     // mva
      },

      fixed: {},

      rateNotes: {
        serviceFee:  'Commercial rate, per agreement.',
        holiday:     'Feriepenger 10,2 % (4 uker + 1 dag). 12 % ved 5 ukers ferie, +2,3 % for ansatte over 60.',
        employerTax: 'Arbeidsgiveravgift sone 1. Norway is geographically zoned from 14,1 % down to 0 % — resolve per employee work location before production.',
        withholding: 'Flat approximation. Real forskuddstrekk comes from the employee\'s skattekort / tabelltrekk.',
        vat:         'Standard mva.'
      },

      certificatePurposes: ['Lånesøknad', 'Boligsøknad', 'Dagpenger (NAV)', 'Annet']
    }
  };

  var DEFAULT_MARKET = 'DK';
  var MARKET_KEY = 'IB_MARKET';

  function list() {
    return Object.keys(MARKETS).map(function (k) { return MARKETS[k]; });
  }

  function get(code) {
    return MARKETS[code] || MARKETS[DEFAULT_MARKET];
  }

  function current() {
    var code;
    try { code = global.localStorage.getItem(MARKET_KEY); } catch (e) { code = null; }
    return get(code || DEFAULT_MARKET);
  }

  function setCurrent(code) {
    if (!MARKETS[code]) return false;
    try { global.localStorage.setItem(MARKET_KEY, code); } catch (e) {}
    return true;
  }

  /* ═══════════════════ PAYROLL ═══════════════════

     calcPayroll(amount, market, opts)

     `amount` is the invoice amount excluding VAT.
     `market` is a market code or a market object.
     `opts.hours` is used by the Danish model to pro-rate ATP; it defaults
     to a full-time month, which overstates ATP for short engagements.

     Returns a flat object. Fields common to both markets:

       invoiceAmount, vat, invoiceTotal, serviceFee, salaryBase,
       gross, holidayPay, employerCost, employeeDeductions, withholding, net

     Market-specific detail lives in `.detail`, and `.lines` is an ordered
     breakdown ready for display — label key, amount, and sign — so a view
     never has to know which model it is rendering.                        */

  function calcPayroll(amount, market, opts) {
    var m = (typeof market === 'string') ? get(market) : (market || current());
    var o = opts || {};
    var invoice = Number(amount) || 0;
    var r = m.rates;

    var vat = invoice * r.vat;
    var invoiceTotal = invoice + vat;
    var serviceFee = invoice * (typeof o.serviceFee === 'number' ? o.serviceFee : r.serviceFee);
    var salaryBase = invoice - serviceFee;

    if (m.model === 'no') return calcNO(m, invoice, vat, invoiceTotal, serviceFee, salaryBase, o);
    if (m.model === 'dk') return calcDK(m, invoice, vat, invoiceTotal, serviceFee, salaryBase, o);
    throw new Error('Unknown payroll model: ' + m.model);
  }

  function calcNO(m, invoice, vat, invoiceTotal, serviceFee, salaryBase, o) {
    var f = typeof o.holiday === 'number' ? o.holiday : m.rates.holiday;
    var a = typeof o.employerTax === 'number' ? o.employerTax : m.rates.employerTax;
    var t = typeof o.withholding === 'number' ? o.withholding : m.rates.withholding;

    var gross = salaryBase / ((1 + f) * (1 + a));
    var holidayPay = gross * f;
    var employerTax = (gross + holidayPay) * a;
    var withholding = gross * t;
    var net = gross - withholding;

    return {
      market: m.code,
      invoiceAmount: invoice, vat: vat, invoiceTotal: invoiceTotal,
      serviceFee: serviceFee, salaryBase: salaryBase,
      gross: gross,
      holidayPay: holidayPay,
      employerCost: holidayPay + employerTax,
      employeeDeductions: withholding,
      withholding: withholding,
      net: net,
      detail: { employerTax: employerTax },
      lines: [
        { key: 'line.invoiceAmount', amount: invoice,      sign:  0 },
        { key: 'line.serviceFee',    amount: serviceFee,   sign: -1 },
        { key: 'line.salaryBase',    amount: salaryBase,   sign:  0 },
        { key: 'line.holidayPay',    amount: holidayPay,   sign: -1 },
        { key: 'line.employerTax',   amount: employerTax,  sign: -1 },
        { key: 'line.gross',         amount: gross,        sign:  0 },
        { key: 'line.withholding',   amount: withholding,  sign: -1 },
        { key: 'line.net',           amount: net,          sign:  0 }
      ]
    };
  }

  function calcDK(m, invoice, vat, invoiceTotal, serviceFee, salaryBase, o) {
    var r = m.rates, fx = m.fixed;
    var f = typeof o.holiday === 'number' ? o.holiday : r.holiday;
    var ox = typeof o.otherEmployer === 'number' ? o.otherEmployer : r.otherEmployer;
    var am = typeof o.amContribution === 'number' ? o.amContribution : r.amContribution;
    var t = typeof o.withholding === 'number' ? o.withholding : r.withholding;

    // ATP is a fixed monthly amount — pro-rate it against a full-time month.
    var factor = (typeof o.hours === 'number' && o.hours > 0)
      ? Math.min(o.hours / fx.fullTimeMonthHours, 1)
      : 1;
    var atpEmployer = fx.atpEmployerMonthly * factor;
    var atpEmployee = fx.atpEmployeeMonthly * factor;

    // An assignment can be too small to carry the fixed ATP contribution.
    // Cap the employer share at whatever the salary base can bear, so the
    // employer side still reconciles exactly instead of going negative.
    if (atpEmployer > salaryBase) atpEmployer = Math.max(salaryBase, 0);

    var gross = (salaryBase - atpEmployer) / (1 + f + ox);
    if (gross < 0) gross = 0;

    var holidayPay = gross * f;
    var otherEmployer = gross * ox;

    // Likewise cap the employee share at gross — you cannot withhold more
    // than was earned.
    if (atpEmployee > gross) atpEmployee = gross;

    var amBase = gross - atpEmployee;
    var amContribution = amBase * am;
    var taxBase = amBase - amContribution;
    var withholding = taxBase * t;
    var net = gross - atpEmployee - amContribution - withholding;

    return {
      market: m.code,
      invoiceAmount: invoice, vat: vat, invoiceTotal: invoiceTotal,
      serviceFee: serviceFee, salaryBase: salaryBase,
      gross: gross,
      holidayPay: holidayPay,
      employerCost: holidayPay + otherEmployer + atpEmployer,
      employeeDeductions: atpEmployee + amContribution + withholding,
      withholding: withholding,
      net: net,
      detail: {
        otherEmployer: otherEmployer,
        atpEmployer: atpEmployer,
        atpEmployee: atpEmployee,
        amContribution: amContribution,
        atpFactor: factor
      },
      lines: [
        { key: 'line.invoiceAmount',  amount: invoice,        sign:  0 },
        { key: 'line.serviceFee',     amount: serviceFee,     sign: -1 },
        { key: 'line.salaryBase',     amount: salaryBase,     sign:  0 },
        { key: 'line.holidayPay',     amount: holidayPay,     sign: -1 },
        { key: 'line.otherEmployer',  amount: otherEmployer,  sign: -1 },
        { key: 'line.atpEmployer',    amount: atpEmployer,    sign: -1 },
        { key: 'line.gross',          amount: gross,          sign:  0 },
        { key: 'line.atpEmployee',    amount: atpEmployee,    sign: -1 },
        { key: 'line.amContribution', amount: amContribution, sign: -1 },
        { key: 'line.withholding',    amount: withholding,    sign: -1 },
        { key: 'line.net',            amount: net,            sign:  0 }
      ]
    };
  }

  /* Aggregate several assignments into one payroll-run summary. */
  function calcPayrollBatch(assignments, market, opts) {
    var sum = {
      count: 0, invoiceAmount: 0, vat: 0, invoiceTotal: 0, serviceFee: 0,
      salaryBase: 0, gross: 0, holidayPay: 0, employerCost: 0,
      employeeDeductions: 0, withholding: 0, net: 0
    };
    (assignments || []).forEach(function (a) {
      var o = Object.assign({}, opts || {}, { hours: a.hours });
      var p = calcPayroll(a.amount, market, o);
      sum.count += 1;
      Object.keys(sum).forEach(function (k) {
        if (k !== 'count' && typeof p[k] === 'number') sum[k] += p[k];
      });
    });
    return sum;
  }

  /* Windows has no flag-emoji font: 🇩🇰 falls back to the letters "DK" in a pair
     of boxes, which is the opposite of the instant recognition a flag is for.
     Every market therefore ships a hand-drawn SVG. These are constants in
     this file — never user input — so they are injected as HTML. */
  function flagHTML(code) {
    var m = MARKETS[code];
    return m && m.flagSVG ? '<span class="flag">' + m.flagSVG + '</span>' : '';
  }

  var API = {
    MARKETS: MARKETS,
    DEFAULT_MARKET: DEFAULT_MARKET,
    MARKET_KEY: MARKET_KEY,
    list: list,
    get: get,
    flagHTML: flagHTML,
    current: current,
    setCurrent: setCurrent,
    calcPayroll: calcPayroll,
    calcPayrollBatch: calcPayrollBatch
  };

  global.IBMarkets = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
