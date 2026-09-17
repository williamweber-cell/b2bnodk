/* ═══════════════════════════════════════════════════════════════════════════
   ib-xlsx.js — zero-dependency .xlsx and .csv reader

   An .xlsx file is a ZIP archive of XML. Both halves are available natively:

     - ZIP inflate  → DecompressionStream('deflate-raw'), in every modern
                      browser and in Node 18+. No JSZip, no pako.
     - XML          → a small hand-rolled scanner rather than DOMParser,
                      because DOMParser does not exist in Node and the sheet
                      XML is machine-generated and highly predictable. One
                      code path runs in the browser and under the test
                      scripts.

   This keeps the project's no-build, no-dependency stance intact.

   What it handles:
     - shared strings, inline strings, formula string results
     - numbers and booleans
     - dates (serial → ISO, including the Excel 1900 leap-year quirk)
     - STORED and DEFLATED zip entries
     - CSV with , or ; or tab, quoted fields, BOM, CRLF

   What it does NOT handle (and does not pretend to):
     - encrypted / password-protected workbooks
     - .xls (the old binary format) — tell the user to re-save as .xlsx
     - formulas (the cached result is read, the formula is not evaluated)

   Entry point:  await IBXlsx.readTable(file)  →  { sheet, headers, rows[] }
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ═══════════════════ ZIP ═══════════════════ */

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  /* Locate the End Of Central Directory record, scanning back from the end.
     The comment field is variable-length, so the signature has to be hunted. */
  function findEOCD(b) {
    const min = Math.max(0, b.length - 65557);        // 64K comment + 22 header
    for (let i = b.length - 22; i >= min; i--) {
      if (u32(b, i) === 0x06054b50) return i;
    }
    return -1;
  }

  function listEntries(bytes) {
    const eocd = findEOCD(bytes);
    if (eocd < 0) throw new Error('NOT_A_ZIP');
    const count = u16(bytes, eocd + 10);
    let p = u32(bytes, eocd + 16);                    // central directory offset
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (u32(bytes, p) !== 0x02014b50) break;
      const method   = u16(bytes, p + 10);
      const compSize = u32(bytes, p + 20);
      const rawSize  = u32(bytes, p + 24);
      const nameLen  = u16(bytes, p + 28);
      const extraLen = u16(bytes, p + 30);
      const cmtLen   = u16(bytes, p + 32);
      const localAt  = u32(bytes, p + 42);
      const name     = utf8(bytes.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name, method, compSize, rawSize, localAt });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  }

  /* Sizes come from the central directory, not the local header: when the
     data-descriptor flag is set the local header carries zeros. */
  async function readEntry(bytes, e) {
    if (u32(bytes, e.localAt) !== 0x04034b50) throw new Error('BAD_LOCAL_HEADER');
    const nameLen  = u16(bytes, e.localAt + 26);
    const extraLen = u16(bytes, e.localAt + 28);
    const start    = e.localAt + 30 + nameLen + extraLen;
    const data     = bytes.subarray(start, start + e.compSize);
    if (e.method === 0) return data;                  // STORED
    if (e.method !== 8) throw new Error('UNSUPPORTED_COMPRESSION_' + e.method);
    return inflateRaw(data);
  }

  async function inflateRaw(data) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  const DEC = new TextDecoder('utf-8');
  function utf8(u8) { return DEC.decode(u8); }

  /* ═══════════════════ XML ═══════════════════
     A scanner, not a parser. Sheet XML from Excel, LibreOffice and every
     payroll exporter follows the same shape; this reads that shape and does
     not attempt general XML. */

  const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  function unescapeXml(s) {
    if (s.indexOf('&') === -1) return s;
    return s.replace(/&(#x?[0-9a-fA-F]+|lt|gt|amp|quot|apos);/g, (m, g) => {
      if (g[0] === '#') {
        const code = g[1] === 'x' || g[1] === 'X'
          ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        return isNaN(code) ? m : String.fromCodePoint(code);
      }
      return ENT[g] !== undefined ? ENT[g] : m;
    });
  }

  /* Concatenated text of every <t> inside a fragment (handles rich text runs,
     where one string is split across several <r><t> elements). */
  function textOfT(fragment) {
    let out = '';
    const re = /<t\b[^>]*?(\/)?>/g;
    let m;
    while ((m = re.exec(fragment))) {
      if (m[1]) continue;                             // self-closing <t/>
      const end = fragment.indexOf('</t>', re.lastIndex);
      if (end === -1) break;
      out += unescapeXml(fragment.slice(re.lastIndex, end));
      re.lastIndex = end + 4;
    }
    return out;
  }

  function parseSharedStrings(xml) {
    const out = [];
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
    let m;
    while ((m = re.exec(xml))) out.push(m[1] ? textOfT(m[1]) : '');
    return out;
  }

  /* Which style indices format a cell as a date. Needed so a "Periode" column
     holding a real date does not render as 45383. */
  const BUILTIN_DATE_FMT = new Set([14,15,16,17,18,19,20,21,22,45,46,47]);
  function parseDateStyles(stylesXml) {
    const dateFmtIds = new Set(BUILTIN_DATE_FMT);
    const numFmtRe = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
    let m;
    while ((m = numFmtRe.exec(stylesXml))) {
      const code = unescapeXml(m[2]).replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
      if (/[dmyhs]/i.test(code) && /[dy]/i.test(code)) dateFmtIds.add(Number(m[1]));
    }
    const dateStyles = new Set();
    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
    if (cellXfs) {
      const xfRe = /<xf\b[^>]*numFmtId="(\d+)"[^>]*>|<xf\b[^>]*numFmtId="(\d+)"[^>]*\/>/g;
      let i = 0, x;
      while ((x = xfRe.exec(cellXfs[1]))) {
        const id = Number(x[1] !== undefined ? x[1] : x[2]);
        if (dateFmtIds.has(id)) dateStyles.add(i);
        i++;
      }
    }
    return dateStyles;
  }

  /* Excel serial → ISO date. Day 0 is 1899-12-30 because Excel keeps Lotus
     1-2-3's bug of treating 1900 as a leap year. */
  function serialToISO(n) {
    const ms = Math.round((n - 25569) * 86400000);    // 25569 = 1970-01-01
    const d = new Date(ms);
    if (isNaN(d.getTime())) return String(n);
    return d.toISOString().slice(0, 10);
  }

  function colOf(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;                                     // A → 0
  }

  /* Rows are placed at their declared r= index, not sequentially: a sheet may
     omit empty rows entirely, and a reported line number has to match the row
     the user actually sees in Excel. */
  function parseSheet(xml, shared, dateStyles) {
    const rows = [];
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
    let rm;
    while ((rm = rowRe.exec(xml))) {
      const attrs = rm[1] !== undefined ? rm[1] : (rm[3] || '');
      const rM = /\br="(\d+)"/.exec(attrs);
      const at = rM ? Number(rM[1]) - 1 : rows.length;
      while (rows.length < at) rows.push([]);
      if (rm[2] === undefined) { rows[at] = []; continue; }
      const cells = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cellRe.exec(rm[2]))) {
        const attrs = cm[1] || '';
        const body  = cm[2] || '';
        const refM  = /\br="([A-Z]+\d+)"/.exec(attrs);
        const idx   = refM ? colOf(refM[1]) : cells.length;
        const tM    = /\bt="([^"]+)"/.exec(attrs);
        const sM    = /\bs="(\d+)"/.exec(attrs);
        const type  = tM ? tM[1] : null;

        let value = '';
        if (type === 's') {
          const vi = /<v>([\s\S]*?)<\/v>/.exec(body);
          value = vi ? (shared[Number(vi[1])] !== undefined ? shared[Number(vi[1])] : '') : '';
        } else if (type === 'inlineStr') {
          value = textOfT(body);
        } else if (type === 'b') {
          const vb = /<v>([\s\S]*?)<\/v>/.exec(body);
          value = vb && vb[1] === '1';
        } else if (type === 'e') {
          const ve = /<v>([\s\S]*?)<\/v>/.exec(body);
          value = ve ? unescapeXml(ve[1]) : '#ERROR';
        } else {
          const vn = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (vn) {
            const raw = unescapeXml(vn[1]);
            if (type === 'str') {
              value = raw;
            } else {
              const num = Number(raw);
              const styled = sM && dateStyles.has(Number(sM[1]));
              value = (!isNaN(num) && styled && num > 0) ? serialToISO(num)
                    : (isNaN(num) ? raw : num);
            }
          }
        }
        while (cells.length < idx) cells.push('');
        cells[idx] = value;
      }
      rows[at] = cells;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  /* ═══════════════════ WORKBOOK ═══════════════════ */

  async function readWorkbook(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let entries;
    try { entries = listEntries(bytes); }
    catch (e) {
      if (e.message === 'NOT_A_ZIP') {
        // .xls (binary) starts with D0 CF 11 E0; anything else is not a workbook.
        if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('LEGACY_XLS');
        throw new Error('NOT_A_WORKBOOK');
      }
      throw e;
    }

    const byName = {};
    entries.forEach(e => { byName[e.name] = e; });
    const get = async n => (byName[n] ? utf8(await readEntry(bytes, byName[n])) : '');

    const shared      = parseSharedStrings(await get('xl/sharedStrings.xml'));
    const dateStyles  = parseDateStyles(await get('xl/styles.xml'));
    const workbookXml = await get('xl/workbook.xml');
    const relsXml     = await get('xl/_rels/workbook.xml.rels');

    // sheet name → target path, via r:id
    const relTarget = {};
    const relRe = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
    let r;
    while ((r = relRe.exec(relsXml))) relTarget[r[1]] = r[2];

    const sheets = [];
    const sheetRe = /<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"[^>]*\/?>/g;
    let s;
    while ((s = sheetRe.exec(workbookXml))) {
      let target = relTarget[s[2]] || '';
      if (target && !target.startsWith('xl/')) target = 'xl/' + target.replace(/^\/+/, '');
      sheets.push({ name: unescapeXml(s[1]), path: target });
    }
    if (!sheets.length) {
      const first = entries.find(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
      if (first) sheets.push({ name: 'Sheet1', path: first.name });
    }
    if (!sheets.length) throw new Error('NO_SHEETS');

    const out = [];
    for (const sh of sheets) {
      const xml = await get(sh.path);
      out.push({ name: sh.name, rows: xml ? parseSheet(xml, shared, dateStyles) : [] });
    }
    return { sheets: out };
  }

  /* ═══════════════════ CSV ═══════════════════
     Many payroll systems export CSV rather than xlsx, and Excel itself
     produces semicolon-separated CSV under Danish and Norwegian locales. */

  function sniffDelimiter(text) {
    const line = text.split(/\r?\n/).find(l => l.trim()) || '';
    const counts = { ';': 0, ',': 0, '\t': 0 };
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && counts[ch] !== undefined) counts[ch]++;
    }
    let best = ';', n = -1;
    for (const d of Object.keys(counts)) if (counts[d] > n) { n = counts[d]; best = d; }
    return n > 0 ? best : ';';
  }

  function parseCSV(text, delimiter) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // BOM
    const d = delimiter || sniffDelimiter(text);
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') {
        inQ = true;
      } else if (c === d) {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (c === '\r') {
        // handled by the \n branch
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // Numeric coercion, tolerating Nordic decimal commas and space grouping.
    return rows.map(r => r.map(v => {
      const t = String(v).trim();
      if (!t) return '';
      const n = t.replace(/\s| /g, '').replace(',', '.');
      return (/^-?\d+(\.\d+)?$/.test(n)) ? Number(n) : t;
    }));
  }

  /* ═══════════════════ ENTRY POINT ═══════════════════ */

  function isBlank(row) {
    return !row || !row.length || row.every(c => c === '' || c === null || c === undefined);
  }

  /* Accept a browser File/Blob, or {name, bytes: Uint8Array}, or
     {name, buffer: ArrayBuffer}.

     Prefer `bytes`: a Node Buffer's `.buffer` is a slice of a SHARED POOL, so
     passing `buf.buffer` hands over unrelated memory — megabytes of whatever
     else the process read. A Uint8Array carries its own offset and length and
     cannot be misread that way. */
  /* `Blob.prototype.bytes()` now exists in browsers and is a METHOD, so a
     truthy `file.bytes` stopped meaning "carries its own data". Read as a
     boolean it made every browser File look like a {bytes} object, and the
     function itself was handed to TextDecoder. Test for a typed array. */
  function ownBytes(file) {
    return ArrayBuffer.isView(file.bytes) ? file.bytes : null;
  }

  async function toBytes(file) {
    var own = ownBytes(file);
    if (own) return own;
    if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
    if (typeof file.bytes === 'function') return new Uint8Array(await file.bytes());
    if (file.buffer) return new Uint8Array(file.buffer);
    throw new Error('NO_FILE_DATA');
  }

  async function readTable(file, opts) {
    const o = opts || {};
    const name = (file.name || '').toLowerCase();
    const isCsv = /\.(csv|txt|tsv)$/.test(name);

    let sheetName = '', rows;
    if (isCsv) {
      const text = (typeof file.text === 'function' && !ownBytes(file))
        ? await file.text()
        : DEC.decode(await toBytes(file));
      rows = parseCSV(text, o.delimiter);
      sheetName = 'CSV';
    } else {
      const bytes = await toBytes(file);
      const wb = await readWorkbook(bytes);
      const sheet = o.sheet
        ? wb.sheets.find(s => s.name === o.sheet) || wb.sheets[0]
        : wb.sheets[0];
      rows = sheet.rows;
      sheetName = sheet.name;
    }

    /* Keep each row's real spreadsheet position. Blank rows are skipped, but
       the surviving rows still report the line the user sees in Excel — an
       error on "line 7" must be line 7 when they open the file. */
    const indexed = rows.map((cells, i) => ({ line: i + 1, cells }))
                        .filter(r => !isBlank(r.cells));
    if (!indexed.length) throw new Error('EMPTY_FILE');

    /* Skip a title banner. Payroll templates commonly put a single label in
       A1 ("Personal data", "Payouts Registration") and the real headers on
       row 2. Without this the banner is read as a one-column header and every
       other column is silently dropped.

       Only skip when the first row holds exactly one value and the next row
       holds at least two — a genuine one-column sheet is then left alone. */
    let start = 0;
    if (indexed.length > 1 && !o.keepBanner) {
      const filled = r => r.cells.filter(c => c !== '' && c !== null && c !== undefined).length;
      if (filled(indexed[0]) === 1 && filled(indexed[1]) >= 2) start = 1;
    }
    const banner = start === 1 ? String(indexed[0].cells.find(c => c !== '') || '') : '';

    const headerRow = indexed[start];
    const headers = headerRow.cells.map(h =>
      String(h === null || h === undefined ? '' : h).trim());
    const width = headers.length;

    return {
      sheet: sheetName,
      banner,
      headerLine: headerRow.line,
      headers,
      rows: indexed.slice(start + 1).map(r => {
        const cells = [];
        for (let c = 0; c < width; c++) {
          const v = r.cells[c];
          cells.push(v === undefined || v === null ? '' : v);
        }
        return { line: r.line, cells };
      })
    };
  }

  const API = {
    readTable, readWorkbook, parseCSV, sniffDelimiter,
    _internals: { listEntries, parseSharedStrings, parseSheet, parseDateStyles,
                  serialToISO, colOf, unescapeXml, textOfT }
  };

  global.IBXlsx = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
