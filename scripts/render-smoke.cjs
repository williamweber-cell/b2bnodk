#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   render-smoke.cjs — execute every view function and assert it renders

   There is no build step and no framework, so a view that references a
   variable which no longer exists fails only when a user clicks that nav
   item. `node --check` will not catch it: the syntax is fine, the reference
   is dead.

   This loads the inline script from each HTML file into a sandbox with a
   minimal DOM and localStorage shim, then calls every render function for
   every role and asserts it returns a non-empty string without throwing.

   Also asserts that a hostile beskrivning comes out escaped.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const coreSrc = fs.readFileSync(path.join(ROOT, 'ib-core.js'), 'utf8');

let failures = 0;
let passes = 0;

const red = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

/* ── Minimal DOM shim ───────────────────────────────────────────────────── */
function makeElement(id) {
  const el = {
    id,
    _html: '',
    _text: '',
    value: '',
    dataset: {},
    style: {},
    classList: {
      _s: new Set(),
      add() {}, remove() {}, toggle() { return false; }, contains() { return false; }
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    addEventListener() {},
    querySelector() { return makeElement('q'); },
    querySelectorAll() { return []; },
    appendChild() {},
    focus() {},
    scrollIntoView() {}
  };
  return el;
}

function makeSandbox() {
  const store = {};
  const els = {};
  const getEl = id => (els[id] || (els[id] = makeElement(id)));

  const document = {
    getElementById: getEl,
    querySelector: () => makeElement('q'),
    querySelectorAll: () => [],
    createElement: tag => makeElement(tag),
    addEventListener: () => {},
    body: makeElement('body'),
    documentElement: makeElement('html')
  };

  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };

  const sandbox = {
    console,
    document,
    localStorage,
    location: { href: '', reload() {} },
    alert: () => {},
    confirm: () => true,
    prompt: () => null,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Intl, Date, Math, JSON, Number, String, Object, Array, parseFloat, parseInt, isNaN
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.window.scrollTo = () => {};
  sandbox.addEventListener = () => {};
  sandbox.scrollTo = () => {};

  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox, { filename: 'ib-core.js' });
  return sandbox;
}

function loadApp(htmlFile) {
  const src = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
  const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const code = blocks[blocks.length - 1];
  const sandbox = makeSandbox();
  vm.runInContext(code, sandbox, { filename: htmlFile });
  return sandbox;
}

/* `let ME` at the top level of the app script is a lexical binding, not a
   property of the global object, so sandbox.ME = x does not reach it. Assign
   from inside the same context instead. */
function setME(sandbox, user) {
  sandbox.__me = user;
  vm.runInContext('ME = __me;', sandbox, { filename: 'set-me' });
}

function check(label, fn) {
  try {
    const out = fn();
    if (typeof out !== 'string' || out.length === 0) {
      failures++;
      console.log(`  ${red('FAIL')} ${label} ${dim('returned ' + typeof out)}`);
    } else {
      passes++;
      console.log(`  ${green('PASS')} ${label} ${dim(out.length + ' chars')}`);
    }
    return out;
  } catch (e) {
    failures++;
    console.log(`  ${red('FAIL')} ${label}`);
    console.log(`       ${e.name}: ${e.message}`);
    return null;
  }
}

/* ── Consultant + company app ───────────────────────────────────────────── */
console.log(bold('\ninvoicery-business.html'));
{
  const app = loadApp('invoicery-business.html');
  app.IB.seed();
  const users = app.IB.getUsers();

  const konsult = users.find(u => u.id === 'U2');
  setME(app, konsult);
  console.log(dim('  as konsult — Sara Bergström'));
  ['kDash', 'kNew', 'kUppdrag', 'kLon', 'kIntyg', 'kProfil'].forEach(fn => {
    check(fn + '()', () => app[fn]());
  });

  const foretag = users.find(u => u.id === 'U4');
  setME(app, foretag);
  console.log(dim('  as företag — Lides Event AB'));
  ['fDash', 'fGodkann', 'fAlla', 'fFakturor', 'fProfil'].forEach(fn => {
    check(fn + '()', () => app[fn]());
  });

  // Escaping must survive a hostile beskrivning end to end.
  console.log(dim('  stored-XSS containment'));
  const ups = app.IB.getUppdrag();
  ups[0].beskrivning = '<img src=x onerror=alert(1)>';
  ups[0].konsultName = '<script>alert(2)</script>';
  ups[0].status = app.IB.STATUS.VANTAR;
  ups[0].foretagId = 'U4';
  app.IB.saveUppdrag(ups);
  const html = check('fGodkann() with hostile input', () => app.fGodkann());
  if (html) {
    if (html.includes('<img src=x onerror=')) {
      failures++;
      console.log(`  ${red('FAIL')} hostile <img> reached the output unescaped`);
    } else if (html.includes('<script>alert(2)')) {
      failures++;
      console.log(`  ${red('FAIL')} hostile <script> reached the output unescaped`);
    } else {
      passes++;
      console.log(`  ${green('PASS')} hostile markup escaped ${dim('&lt;img …')}`);
    }
  }
}

/* ── Admin app ──────────────────────────────────────────────────────────── */
console.log(bold('\ninvoicery-business-admin.html'));
{
  const app = loadApp('invoicery-business-admin.html');
  app.IB.seed();
  ['aDash', 'aActivity', 'aGodkann', 'aAllaUppdrag', 'aKonsulter',
   'aForetag', 'aLon', 'aFakturor', 'aTjanster', 'aInst'].forEach(fn => {
    check(fn + '()', () => app[fn]());
  });

  // The payroll run must reconcile against the sum of the payslips.
  console.log(dim('  payroll reconciliation'));
  const godkanda = app.IB.getUppdrag().filter(u => u.status === app.IB.STATUS.GODKANT);
  const batch = app.IB.calcPayrollBatch(godkanda);
  const sum = godkanda.reduce((a, u) => a + app.IB.calcPayroll(u.belopp).nettolon, 0);
  if (Math.abs(batch.nettolon - sum) < 0.000001) {
    passes++;
    console.log(`  ${green('PASS')} lönekörning total equals sum of payslips ` +
                dim(app.IB.fmtN(batch.nettolon)));
  } else {
    failures++;
    console.log(`  ${red('FAIL')} lönekörning total ${batch.nettolon} != payslip sum ${sum}`);
  }
}

console.log('');
if (failures === 0) {
  console.log(green(bold(`  ${passes} views rendered cleanly.`)));
  process.exit(0);
} else {
  console.log(red(bold(`  ${failures} failed, ${passes} passed.`)));
  process.exit(1);
}
