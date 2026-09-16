#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   guard-edit.cjs — PostToolUse hook for Invoicery Business

   Runs after Claude edits or writes a .html or .js file in this project and
   reports four classes of defect that are invisible on inspection:

     1. HOMOGLYPHS   Cyrillic/Greek lookalikes in source. Nordic aeoaa are
                     fine; Cyrillic a/p/e/o are not. This is what made
                     sparaKonsult a silent landmine.
     2. RATE LITERALS Money math done in a view instead of IB.calcPayroll.
                     Denmark and Norway use structurally different models,
                     so a literal is wrong in at least one market by
                     construction.
     3. UNESCAPED     User-derived values interpolated into innerHTML
                     templates without esc().
     4. SWEDISH       Leftover Swedish copy. The product serves DK and NO.

   Reads the hook payload on stdin, writes findings to stderr and exits 2 so
   the message is fed back to Claude. Never blocks the edit — these are
   advisory, and a false positive should not stop work.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let file;
  try {
    const payload = JSON.parse(raw || '{}');
    file = (payload.tool_input && (payload.tool_input.file_path || payload.tool_input.path)) || '';
  } catch (e) {
    process.exit(0);
  }

  if (!file || !/\.(html|js|cjs|mjs)$/i.test(file)) process.exit(0);
  if (/[\\/](node_modules|\.git)[\\/]/.test(file)) process.exit(0);

  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch (e) { process.exit(0); }

  const name = file.split(/[\\/]/).pop();
  const isCore = ['ib-core.js', 'ib-markets.js', 'ib-i18n.js',
                  'ib-xlsx.js', 'ib-xlsx-write.js', 'ib-lists.js'].includes(name);
  /* Node tooling under scripts/ and the hooks themselves: these print to a
     terminal and never render HTML, so the escaping and rate-literal rules
     do not apply. Matching on the directory rather than a filename list
     means a new check script is covered the day it is written. */
  const isCheck = /(^|[\\/])(scripts|hooks)[\\/]/.test(file) || /guard-edit/.test(name);
  const lines = src.split(/\r?\n/);
  const findings = [];

  /* ── 1. Homoglyphs ─────────────────────────────────────────────────── */
  const confusable = /[Ѐ-ӿͰ-Ͽ]/;
  if (!isCheck) {
    lines.forEach((line, i) => {
      if (!confusable.test(line)) return;
      const chars = [...new Set([...line].filter(c => confusable.test(c)))]
        .map(c => `"${c}" U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
      findings.push(
        `${name}:${i + 1}  Cyrillic/Greek homoglyph in source: ${chars.join(', ')}\n` +
        `    Replace with the ASCII letter it imitates. Check the call site too — ` +
        `these are usually pasted in pairs and both are poisoned.`
      );
    });
  }

  /* ── 2. Rate literals outside ib-core.js ───────────────────────────── */
  if (!isCore && !isCheck) {
    const rates = [
      [/\*\s*0\.06\b/,  'serviceFee 0.06'],
      [/\*\s*0\.141\b/, 'arbeidsgiveravgift 0.141 (NO)'],
      [/\*\s*0\.102\b/, 'feriepenger 0.102 (NO)'],
      [/\*\s*0\.125\b/, 'feriegodtgoerelse 0.125 (DK)'],
      [/\*\s*0\.08\b/,  'AM-bidrag 0.08 (DK)'],
      [/\*\s*0\.32\b/,  'forskuddstrekk 0.32 (NO)'],
      [/\*\s*0\.38\b/,  'A-skat 0.38 (DK)'],
      [/\*\s*1\.25\b/,  'vat 1.25'],
      [/\*\s*0\.25\b/,  'vat 0.25'],
      [/\/\s*1\.3142\b/,'legacy SE divisor 1.3142']
    ];
    lines.forEach((line, i) => {
      if (/^\s*\.mkt|^\s*--/.test(line)) return;   // CSS, not money
      rates.forEach(([re, what]) => {
        if (re.test(line)) {
          findings.push(
            `${name}:${i + 1}  inline rate literal (${what})\n` +
            `    Views must not compute money, and the two markets use ` +
            `different models. Use IB.calcPayroll(amount, {hours}) or ` +
            `IB.calcPayrollBatch(list) and read the field off the result.`
          );
        }
      });
    });
  }

  /* ── 3. Unescaped user data in templates ───────────────────────────── */
  if (!isCore && !isCheck) {
    const userFields = [
      'description', 'consultantName', 'companyName', 'adminNote',
      'contactName', 'regNumber', 'personalId', 'period'
    ];
    lines.forEach((line, i) => {
      userFields.forEach(f => {
        // ${something.field} not already wrapped in esc(
        const re = new RegExp('\\$\\{(?!esc\\()[A-Za-z_$][\\w$]*\\.' + f + '\\b', 'g');
        if (re.test(line)) {
          findings.push(
            `${name}:${i + 1}  unescaped "${f}" interpolated into a template\n` +
            `    Wrap it: \${esc(a.${f})}. Stored XSS — a consultant can script ` +
            `the company and admin screens by typing into a form field.`
          );
        }
      });
    });
  }

  /* ── 4. Swedish leftovers ──────────────────────────────────────────── */
  if (!isCheck) {
    const swedish = /(uppdrag|konsult|företag|lönekörning|arbetsgivaravgift|timlön|godkänt|utbetalt|avvisat|Logga in|Översikt)/;
    lines.forEach((line, i) => {
      if (swedish.test(line)) {
        findings.push(
          `${name}:${i + 1}  Swedish term in source\n` +
          `    This product serves Denmark and Norway only. UI copy goes ` +
          `through t('key') in ib-i18n.js; schema field names are English.`
        );
      }
    });
  }

  if (findings.length === 0) process.exit(0);

  const shown = findings.slice(0, 12);
  process.stderr.write(
    `\nInvoicery Business guard — ${findings.length} issue(s) in ${name}:\n\n` +
    shown.map(f => '  ' + f).join('\n\n') +
    (findings.length > shown.length
      ? `\n\n  …and ${findings.length - shown.length} more. Run: node scripts/payroll-check.cjs`
      : '') +
    `\n\nSee CLAUDE.md for the rules behind these.\n`
  );
  process.exit(2);
});
