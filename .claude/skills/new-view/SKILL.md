---
name: new-view
description: Scaffold a new portal view — TITLES entry, go() branch, sidebar nav item and render function — wired correctly across all four sites in the right file.
disable-model-invocation: true
---

# /new-view

Add a portal view. Adding one by hand means editing four disconnected places
in a 1 400-line file, and doing three of the four produces a silently blank
page with no error.

## Arguments

`/new-view <role> <slug> "<Title>" "<Subtitle>"`

Example: `/new-view k rapporter "Rapporter" "Ladda ner underlag och sammanställningar"`

If the user did not supply arguments, ask for the role and the title; derive
the slug yourself and state what you derived.

## Role prefixes

| Prefix | Role | File | Sidebar block |
|---|---|---|---|
| `k-` | konsult | `invoicery-business.html` | `#nav-konsult` |
| `f-` | företag | `invoicery-business.html` | `#nav-foretag` |
| `a-` | admin | `invoicery-business-admin.html` | admin sidebar |

The view id is `<prefix><slug>`, e.g. `k-rapporter`.

## The four edits

Make all four, in this order, in the file the prefix selects.

**1. `TITLES` map** — page heading and subheading:

```js
'k-rapporter':['Rapporter','Ladda ner underlag och sammanställningar'],
```

**2. `go()` dispatch** — add a branch in the existing if/else chain, grouped
with the other views of the same role:

```js
else if(v==='k-rapporter') el.innerHTML=kRapporter();
```

**3. Sidebar nav item** — inside the correct role's `<nav>` block. Match the
surrounding markup exactly, including the `data-v` attribute and a Feather-
style inline SVG in an `.lci` span:

```html
<button class="sb-i" data-v="k-rapporter" onclick="go('k-rapporter')">
  <span class="lci"><svg viewBox="0 0 24 24"><!-- 24x24 stroke icon --></svg></span>
  Rapporter
</button>
```

**4. Render function** — camelCase of the view id, returning a template
string. Follow the house shape: a `.card` with `.card-hd` / `.card-bd`, and
an `.empty` block when there is no data.

```js
function kRapporter(){
  const ups=getUppdrag().filter(u=>u.konsultId===ME.id);
  if(!ups.length) return `<div class="empty">
    <div class="empty-ico">…</div>
    <h3>Inga rapporter ännu</h3>
    <p>…</p>
  </div>`;
  return `
  <div class="card">
    <div class="card-hd"><span class="card-title">Rapporter</span></div>
    <div class="card-bd">…</div>
  </div>`;
}
```

## Rules the scaffold must follow

- Every user-derived value interpolated into the template goes through
  `esc()` — names, `beskrivning`, `period`, `adminNote`, and anything inside
  an `onclick="fn('${...}')"` attribute.
- Any money comes from `IB.calcPayroll()` / `IB.calcPayrollBatch()` and is
  displayed with `fmtN()`. No rate literals.
- Status comparisons use `IB.STATUS.*`, not retyped strings with diacritics.
- Konsult views filter on `u.konsultId===ME.id`; företag views on
  `u.foretagId===ME.id`. Admin views see everything.
- Identifiers ASCII-only — no Cyrillic or Greek homoglyphs.

## Afterwards

```bash
node scripts/payroll-check.cjs
```

Then tell the user to open the file and click the new nav item, since there
is no test harness that exercises rendering.
