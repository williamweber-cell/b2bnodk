---
name: new-view
description: Scaffold a new portal view — title keys, VIEWS entry, sidebar nav item and render function — wired correctly and translated into both languages.
disable-model-invocation: true
---

# /new-view

Add a portal view. By hand this is four disconnected edits plus three
translation keys in two languages; doing seven of the ten produces a blank
page or an untranslated marker.

## Arguments

`/new-view <role> <slug> "<Danish title>" "<Norwegian title>"`

Example: `/new-view c reports "Rapporter" "Rapporter"`

If the user gave no arguments, ask for the role and the Danish title; derive
the slug and draft the Norwegian yourself, then state what you derived so they
can correct it.

## Role prefixes

| Prefix | Role | File | Sidebar block |
|---|---|---|---|
| `c-` | consultant | `invoicery-business.html` | `#nav-consultant` |
| `b-` | company | `invoicery-business.html` | `#nav-company` |
| `a-` | admin | `invoicery-business-admin.html` | admin sidebar |

View id is `<prefix><slug>`, e.g. `c-reports`. The render function is the
camelCase form: `cReports`.

## The edits

**1. Translation keys** — `ib-i18n.js`, in **both** `da` and `nb`:

```js
'nav.c.reports':   'Rapporter',
'title.c.reports': 'Rapporter',
'sub.c.reports':   'Download underlag og opgørelser',
```

Note the key shape: `go()` derives them by replacing the first `-` with `.`,
so view `c-reports` looks up `title.c.reports` and `sub.c.reports`.

**2. `VIEWS` map** — maps view id to render function:

```js
const VIEWS={ /* … */ 'c-reports':cReports };
```

**3. Sidebar nav item** — inside the correct role's block, matching the
surrounding markup including `data-v` and a 24×24 stroke SVG:

```html
<li><button onclick="go('c-reports')" data-v="c-reports">
  <span class="lci"><svg viewBox="0 0 24 24"><!-- icon --></svg></span>
  <span data-i18n="nav.c.reports">Rapporter</span>
</button></li>
```

The label goes in its own `span[data-i18n]` so the icon survives translation.

**4. Render function** — returns a template string:

```js
function cReports(){
  const list=mine();
  if(!list.length) return empty(ICO_DOC,'c.reports.empty.h','c.reports.empty.p');
  return `
  <div class="card">
    <div class="card-hd"><span class="card-title">${esc(t('nav.c.reports'))}</span></div>
    <div class="card-bd"></div>
  </div>`;
}
```

## Rules the scaffold must follow

- No user-visible string inline. `t('key')` everywhere, keys in both languages.
- Every interpolated user value through `esc()`, including inside
  `onclick="fn('…')"` and `data-*` attributes.
- Money only from `IB.calcPayroll(amount,{hours})` or `calcPayrollBatch`,
  displayed with `fmtN()`. Never a rate literal — the two markets differ.
- Status via `IB.STATUS.*`, labels via `t('status.'+s)`.
- Consultant views filter with `mine()`, company views with `ours()`, admin
  sees everything.
- Identifiers ASCII.

## Afterwards

```bash
node scripts/payroll-check.cjs
node scripts/render-smoke.cjs
```

The smoke test does not discover new functions — add the name to
`CONSULTANT_VIEWS`, `COMPANY_VIEWS` or `ADMIN_VIEWS` in
`scripts/render-smoke.cjs` so it is exercised in both markets.
