/* ═══════════════════════════════════════════════════════════════════════════
   ib-xlsx-write.js — zero-dependency .xlsx writer

   Counterpart to ib-xlsx.js. An .xlsx is a ZIP of XML, and writing one needs
   only a CRC32 and the ZIP headers — entries are STORED (uncompressed), which
   Excel, LibreOffice, Google Sheets and Numbers all accept. Deflate would
   shrink the file but requires async CompressionStream; these lists are
   kilobytes, so the trade is not worth the complexity.

   Strings are written as inline strings rather than a shared-strings table.
   Slightly larger, far simpler, and immune to index drift.

   Produces: a Blob (browser) or Uint8Array (Node).

     IBXlsxWrite.build({
       sheet: 'Personal data',
       title: 'Personal data',          // optional bold banner row
       columns: [{header, width, type}],
       rows: [[...], [...]]
     })
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ═══════════════════ CRC32 ═══════════════════ */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  var ENC = new TextEncoder();
  function utf8(s) { return ENC.encode(s); }

  /* ═══════════════════ ZIP ═══════════════════ */

  function dosDateTime(d) {
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2 | 0);
    return { date: date & 0xffff, time: time & 0xffff };
  }

  function zip(files) {
    var now = dosDateTime(new Date());
    var parts = [], central = [], offset = 0;

    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + name.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);          // UTF-8 filename flag
      lv.setUint16(8, 0, true);               // STORED
      lv.setUint16(10, now.time, true);
      lv.setUint16(12, now.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);

      parts.push(local, data);

      var cd = new Uint8Array(46 + name.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, now.time, true);
      cv.setUint16(14, now.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cd.set(name, 46);
      central.push(cd);

      offset += local.length + data.length;
    });

    var cdSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    var total = offset + cdSize + 22;
    var out = new Uint8Array(total);
    var p = 0;
    parts.forEach(function (b) { out.set(b, p); p += b.length; });
    central.forEach(function (b) { out.set(b, p); p += b.length; });
    out.set(eocd, p);
    return out;
  }

  /* ═══════════════════ XML ═══════════════════ */

  var XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  function xe(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, function (c) { return XML_ESC[c]; })
      /* Control characters are illegal in XML 1.0 and make Excel report the
         file as corrupt. Strip rather than escape. */
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  function colName(i) {
    var s = '';
    i += 1;
    while (i > 0) {
      var r = (i - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      i = (i - r - 1) / 26;
    }
    return s;
  }

  var CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  var ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  var WB_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  /* style 0 = default, 1 = bold (header), 2 = bold banner, 3 = date,
     4 = 2-decimal number, 5 = text (forces leading zeros to survive) */
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>' +
    '<fonts count="3">' +
      '<font><sz val="10"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="10"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEFF3F7"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FFB8C6D4"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '</styleSheet>';

  var S_DEFAULT = 0, S_HEADER = 1, S_BANNER = 2, S_DATE = 3, S_NUM = 4, S_TEXT = 5;

  function cell(ref, value, type, style) {
    if (value === null || value === undefined || value === '') {
      return style ? '<c r="' + ref + '" s="' + style + '"/>' : '';
    }
    if (type === 'number' && typeof value === 'number' && isFinite(value)) {
      return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + '><v>' + value + '</v></c>';
    }
    return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') +
           ' t="inlineStr"><is><t xml:space="preserve">' + xe(value) + '</t></is></c>';
  }

  function build(spec) {
    var columns = spec.columns || [];
    var rows = spec.rows || [];
    var hasTitle = !!spec.title;

    var xmlRows = [];
    var r = 1;

    if (hasTitle) {
      xmlRows.push('<row r="1">' + cell('A1', spec.title, 'string', S_BANNER) + '</row>');
      r = 2;
    }

    var headerRow = r;
    xmlRows.push('<row r="' + r + '">' + columns.map(function (c, i) {
      return cell(colName(i) + r, c.header, 'string', S_HEADER);
    }).join('') + '</row>');
    r++;

    rows.forEach(function (row) {
      var cells = columns.map(function (c, i) {
        var v = row[i];
        var style = S_DEFAULT;
        var type = 'string';
        if (c.type === 'number' && typeof v === 'number') { style = S_NUM; type = 'number'; }
        else if (c.type === 'date') style = S_DATE;
        /* Personal IDs, ZIPs and bank accounts must stay text: Excel would
           otherwise eat leading zeros and turn long digit strings into
           scientific notation. */
        else if (c.type === 'text') style = S_TEXT;
        return cell(colName(i) + r, v, type, style);
      }).join('');
      xmlRows.push('<row r="' + r + '">' + cells + '</row>');
      r++;
    });

    var cols = columns.map(function (c, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
             (c.width || 18) + '" customWidth="1"/>';
    }).join('');

    var lastCol = colName(Math.max(columns.length - 1, 0));
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>' +
      '<dimension ref="A1:' + lastCol + Math.max(r - 1, 1) + '"/>' +
      '<sheetViews><sheetView workbookViewId="0">' +
        '<pane ySplit="' + headerRow + '" topLeftCell="A' + (headerRow + 1) +
        '" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="14.5"/>' +
      (cols ? '<cols>' + cols + '</cols>' : '') +
      '<sheetData>' + xmlRows.join('') + '</sheetData>' +
      '<autoFilter ref="A' + headerRow + ':' + lastCol + Math.max(r - 1, headerRow) + '"/>' +
      '</worksheet>';

    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + xe((spec.sheet || 'Sheet1').slice(0, 31)) +
      '" sheetId="1" r:id="rId1"/></sheets></workbook>';

    return zip([
      { name: '[Content_Types].xml',        data: utf8(CT) },
      { name: '_rels/.rels',                data: utf8(ROOT_RELS) },
      { name: 'xl/workbook.xml',            data: utf8(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(WB_RELS) },
      { name: 'xl/styles.xml',              data: utf8(STYLES) },
      { name: 'xl/worksheets/sheet1.xml',   data: utf8(sheet) }
    ]);
  }

  /* Browser convenience: build and hand the user a file. */
  function download(filename, spec) {
    var bytes = build(spec);
    var blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    var url = URL.createObjectURL(blob);
    var a = global.document.createElement('a');
    a.href = url; a.download = filename;
    global.document.body.appendChild(a); a.click();
    global.document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  var API = { build: build, download: download, crc32: crc32, colName: colName, zip: zip };
  global.IBXlsxWrite = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
