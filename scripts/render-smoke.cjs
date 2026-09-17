#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   render-smoke.cjs — execute every view in every market and assert it renders

   No build step and no framework, so a view referencing a variable that no
   longer exists fails only when a user clicks that nav item. `node --check`
   cannot catch it: the syntax is valid, the reference is dead.

   Loads each app's inline script into a sandbox with a minimal DOM shim, then
   for BOTH markets calls every render function for every role and asserts it
   returns a non-empty string containing no untranslated ⟦key⟧ marker.

   Also asserts hostile input stays escaped and that the payroll run
   reconciles against the sum of the payslips.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LIBS = ['ib-markets.js', 'ib-i18n.js', 'ib-core.js', 'ib-xlsx.js', 'ib-import.js']
  .map(f => ({ name: f, src: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

let failures = 0, passes = 0;
const red = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

/* ── minimal DOM shim ───────────────────────────────────────────────────── */
function makeElement(id) {
  return {
    id, _html: '', _text: '', value: '', dataset: {}, style: {},
    classList: { add(){}, remove(){}, toggle(){return false}, contains(){return false} },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
    setAttribute(){}, getAttribute(){return null}, addEventListener(){},
    querySelector(){ return makeElement('q'); }, querySelectorAll(){ return []; },
    appendChild(){}, focus(){}, scrollIntoView(){}
  };
}

function makeSandbox(marketCode) {
  const store = {};
  const els = {};
  const getEl = id => (els[id] || (els[id] = makeElement(id)));
  const document = {
    getElementById: getEl,
    querySelector: () => makeElement('q'),
    querySelectorAll: () => [],
    createElement: t => makeElement(t),
    addEventListener: () => {},
    body: makeElement('body'),
    documentElement: makeElement('html')
  };
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const sandbox = {
    console, document, localStorage,
    location: { href: '', reload() {} },
    alert: () => {}, confirm: () => true, prompt: () => null,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Intl, Date, Math, JSON, Number, String, Object, Array, Set, Map,
    parseFloat, parseInt, isNaN,
    // web platform globals used by ib-xlsx.js — present in browsers and in
    // Node 18+, but not injected into a bare vm context
    TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView,
    Blob, Response, URL, Promise, Error, RegExp, DecompressionStream
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.scrollTo = () => {};
  vm.createContext(sandbox);
  LIBS.forEach(l => vm.runInContext(l.src, sandbox, { filename: l.name }));
  // Select the market BEFORE the app script boots, so seed and language match.
  sandbox.IBMarkets.setCurrent(marketCode);
  sandbox.IB.syncLang();
  return sandbox;
}

function loadApp(htmlFile, marketCode) {
  const src = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
  const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const sandbox = makeSandbox(marketCode);
  vm.runInContext(blocks[blocks.length - 1], sandbox, { filename: htmlFile });
  return sandbox;
}

/* `let ME` is a lexical binding, not a property of the global object, so
   sandbox.ME = x does not reach it. Assign from inside the same context. */
function setME(sandbox, user) {
  sandbox.__me = user;
  vm.runInContext('ME = __me;', sandbox, { filename: 'set-me' });
}

function check(label, fn) {
  try {
    const out = fn();
    if (typeof out !== 'string' || out.length === 0) {
      failures++; console.log(`  ${red('FAIL')} ${label} ${dim('returned ' + typeof out)}`);
      return null;
    }
    const untranslated = out.match(/⟦[^⟧]+⟧/g);
    if (untranslated) {
      failures++;
      console.log(`  ${red('FAIL')} ${label} ${dim('untranslated: ' + [...new Set(untranslated)].join(', '))}`);
      return out;
    }
    passes++; console.log(`  ${green('PASS')} ${label} ${dim(out.length + ' chars')}`);
    return out;
  } catch (e) {
    failures++;
    console.log(`  ${red('FAIL')} ${label}`);
    console.log(`       ${e.name}: ${e.message}`);
    return null;
  }
}

const CONSULTANT_VIEWS = ['cDash','cNew','cList','cPay','cCert','cProfile'];
const COMPANY_VIEWS    = ['bDash','bApprove','bAll','bImport','bInvoices','bProfile'];
const ORDER_VIEW       = 'bOrder';
const ADMIN_VIEWS      = ['aDash','aActivity','aApprove','aAll','aImport','aConsultants',
                          'aCompanies','aPayroll','aInvoices','aServices','aSettings'];
const INVOICE_VIEW     = 'aInvoice';

for (const code of ['DK', 'NO']) {
  const label = code === 'DK' ? 'Denmark (da-DK, DKK)' : 'Norway (nb-NO, NOK)';
  console.log(bold(`\n══════ ${label} ══════`));

  /* ── consultant + company app ── */
  console.log(bold('invoicery-business.html'));
  {
    const app = loadApp('invoicery-business.html', code);
    const users = app.IB.getUsers();

    setME(app, users.find(u => u.role === 'consultant'));
    console.log(dim('  as consultant'));
    CONSULTANT_VIEWS.forEach(fn => check(fn + '()', () => app[fn]()));

    setME(app, users.find(u => u.role === 'company'));
    console.log(dim('  as company'));
    COMPANY_VIEWS.forEach(fn => check(fn + '()', () => app[fn]()));

    console.log(dim('  stored-XSS containment'));
    const list = app.IB.getAssignments();
    list[0].description = '<img src=x onerror=alert(1)>';
    list[0].consultantName = '<script>alert(2)</script>';
    list[0].status = app.IB.STATUS.CUSTOMER;   // what bApprove() filters on
    list[0].companyId = users.find(u => u.role === 'company').id;
    app.IB.saveAssignments(list);
    // the order detail view, opened on a real assignment
    const firstOwn = app.IB.getAssignments()
      .find(a => a.companyId === users.find(u => u.role === 'company').id);
    if (firstOwn) {
      vm.runInContext('CURRENT_ORDER = ' + JSON.stringify(firstOwn.id) + ';', app,
                      { filename: 'set-order' });
      const orderHtml = check('bOrder()', () => app.bOrder());

      /* The order detail shows what the company PAYS. calcPayroll also
         returns what the consultant earns, so putting gross or net on this
         screen is one careless line away, and the company would never know
         it was reading someone's salary. */
      if (orderHtml) {
        const pay = app.IB.calcPayroll(firstOwn.amount, { hours: firstOwn.hours });
        const shown = ['invoiceAmount', 'vat', 'invoiceTotal']
          .map(k => app.IB.fmtN(pay[k]));
        const secret = ['gross', 'net', 'withholding', 'holidayPay']
          .map(k => [k, app.IB.fmtN(pay[k])])
          // a figure that legitimately appears cannot also be a leak
          .filter(([, v]) => !shown.includes(v));
        const leaked = secret.filter(([, v]) => orderHtml.includes(v));
        if (leaked.length) {
          failures++;
          console.log(`  ${red('FAIL')} bOrder() leaks consultant salary: ` +
                      leaked.map(([k, v]) => `${k} ${v}`).join(', '));
        } else {
          passes++;
          console.log(`  ${green('PASS')} bOrder() shows no salary figures ` +
                      dim(`(${secret.length} checked)`));
        }
      }
    }
    // an unknown id must render the not-found state, not throw
    vm.runInContext('CURRENT_ORDER = "NOPE-1";', app, { filename: 'set-order' });
    check('bOrder() with an unknown id', () => app.bOrder());

    const html = check('bApprove() with hostile input', () => app.bApprove());
    if (html) {
      if (html.includes('<img src=x onerror=') || html.includes('<script>alert(2)')) {
        failures++; console.log(`  ${red('FAIL')} hostile markup reached the output unescaped`);
      } else {
        passes++; console.log(`  ${green('PASS')} hostile markup escaped`);
      }
    }
  }

  /* ── admin app ── */
  console.log(bold('invoicery-business-admin.html'));
  {
    const app = loadApp('invoicery-business-admin.html', code);
    ADMIN_VIEWS.forEach(fn => check(fn + '()', () => app[fn]()));

    /* The invoice detail, opened on a real assignment and on a bad id. It
       renders salary and bank details on purpose — this is the side of the
       wall that is allowed to. */
    const anyAsg = app.IB.getAssignments()[0];
    if (anyAsg) {
      vm.runInContext('CURRENT_INVOICE = ' + JSON.stringify(anyAsg.id) + ';', app,
                      { filename: 'set-invoice' });
      check(INVOICE_VIEW + '()', () => app[INVOICE_VIEW]());
    }
    vm.runInContext('CURRENT_INVOICE = "NOPE-1";', app, { filename: 'set-invoice' });
    check(INVOICE_VIEW + '() with an unknown id', () => app[INVOICE_VIEW]());

    /* Every status the register can hold must render in the queue and the
       detail, including the handover state the company list reads. */
    const statuses = Object.values(app.IB.STATUS);
    const asgList = app.IB.getAssignments();
    let statusOk = true;
    for (const st of statuses) {
      asgList[0].status = st;
      app.IB.saveAssignments(asgList);
      vm.runInContext('CURRENT_INVOICE = ' + JSON.stringify(asgList[0].id) + ';', app,
                      { filename: 'set-invoice' });
      try {
        const out = app[INVOICE_VIEW]();
        if (out.includes('⟦')) { statusOk = false; console.log(`  ${red('FAIL')} ${st}: missing key`); }
      } catch (e) { statusOk = false; console.log(`  ${red('FAIL')} ${st}: ${e.message}`); }
    }
    if (statusOk) { passes++; console.log(`  ${green('PASS')} aInvoice() renders every status ${dim(statuses.join(', '))}`); }
    else failures++;

    console.log(dim('  payroll reconciliation'));
    const approved = app.IB.getAssignments().filter(a => a.status === app.IB.STATUS.APPROVED);
    const batch = app.IB.calcPayrollBatch(approved);
    const sum = approved.reduce((a, x) =>
      a + app.IB.calcPayroll(x.amount, { hours: x.hours }).net, 0);
    if (Math.abs(batch.net - sum) < 0.000001) {
      passes++;
      console.log(`  ${green('PASS')} payroll total equals sum of payslips ${dim(app.IB.fmtN(batch.net))}`);
    } else {
      failures++;
      console.log(`  ${red('FAIL')} payroll total ${batch.net} != payslip sum ${sum}`);
    }

    console.log(dim('  market identity'));
    const m = app.IB.market();
    if (m.code === code && m.currency === (code === 'DK' ? 'DKK' : 'NOK')) {
      passes++;
      console.log(`  ${green('PASS')} ${m.entity.legalName} · ${m.currency} · ${m.locale}`);
    } else {
      failures++;
      console.log(`  ${red('FAIL')} wrong market loaded: ${m.code}`);
    }

    /* Language is a separate decision from business. An English-speaking
       administrator in the Danish books must stay in English after moving to
       the Norwegian ones — the old code derived language from the market, so
       switching business silently threw the language choice away. */
    console.log(dim('  language is independent of business'));
    const before = app.IB.language();
    app.IB.setLanguage('en');
    const chosen = app.IB.language();
    app.IB.setMarket(code === 'DK' ? 'NO' : 'DK');
    const after = app.IB.language();
    app.IB.setMarket(code);
    app.IB.setLanguage(before);

    if (chosen === 'en' && after === 'en') {
      passes++;
      console.log(`  ${green('PASS')} English survives a business switch`);
    } else {
      failures++;
      console.log(`  ${red('FAIL')} language reset to ${after} on business switch`);
    }

    const langs = Object.keys(app.IBi18n.STRINGS);
    if (langs.length === 3 && langs.includes('en')) {
      passes++;
      console.log(`  ${green('PASS')} three languages offered ${dim(langs.join(', '))}`);
    } else {
      failures++;
      console.log(`  ${red('FAIL')} languages offered: ${langs.join(', ')}`);
    }
  }
}

console.log('');
if (failures === 0) { console.log(green(bold(`  ${passes} checks passed across both markets.`))); process.exit(0); }
console.log(red(bold(`  ${failures} failed, ${passes} passed.`)));
process.exit(1);
