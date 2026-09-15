# -*- coding: utf-8 -*-
"""Build realistic .xlsx fixtures with stdlib zipfile (real DEFLATE), so the
inflate path in ib-xlsx.js is genuinely exercised."""
import zipfile, os, sys, html

OUT = sys.argv[1] if len(sys.argv) > 1 else 'fixtures'
os.makedirs(OUT, exist_ok=True)

CT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>'''

ROOT_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''

WB_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''

def workbook(sheetname):
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets></workbook>'
            % html.escape(sheetname))

# style 1 = date (numFmtId 14), style 2 = custom date, style 0 = general
STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="1"><font><sz val="11"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>'''

def colname(i):
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s

def build(path, sheetname, grid):
    """grid: list of rows; each cell is ('s', text) | ('n', number) | ('d', serial) | ('i', text inline)"""
    shared, sidx = [], {}
    def sid(t):
        if t not in sidx:
            sidx[t] = len(shared); shared.append(t)
        return sidx[t]

    rows_xml = []
    for r, row in enumerate(grid, start=1):
        cells = []
        for c, cell in enumerate(row):
            if cell is None:
                continue
            kind, val = cell
            ref = '%s%d' % (colname(c), r)
            if kind == 's':
                cells.append('<c r="%s" t="s"><v>%d</v></c>' % (ref, sid(val)))
            elif kind == 'i':
                cells.append('<c r="%s" t="inlineStr"><is><t>%s</t></is></c>' % (ref, html.escape(val)))
            elif kind == 'n':
                cells.append('<c r="%s"><v>%s</v></c>' % (ref, val))
            elif kind == 'd':
                cells.append('<c r="%s" s="1"><v>%s</v></c>' % (ref, val))
            elif kind == 'd2':
                cells.append('<c r="%s" s="2"><v>%s</v></c>' % (ref, val))
        rows_xml.append('<row r="%d">%s</row>' % (r, ''.join(cells)))

    sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             '<sheetData>%s</sheetData></worksheet>' % ''.join(rows_xml))

    ss = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="%d" uniqueCount="%d">%s</sst>'
          % (len(shared), len(shared),
             ''.join('<si><t>%s</t></si>' % html.escape(t) for t in shared)))

    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', CT)
        z.writestr('_rels/.rels', ROOT_RELS)
        z.writestr('xl/workbook.xml', workbook(sheetname))
        z.writestr('xl/_rels/workbook.xml.rels', WB_RELS)
        z.writestr('xl/styles.xml', STYLES)
        z.writestr('xl/sharedStrings.xml', ss)
        z.writestr('xl/worksheets/sheet1.xml', sheet)
    print('wrote', path)


# ── 1. Danish company import: clean ──────────────────────────────────────
build(os.path.join(OUT, 'dk-clean.xlsx'), 'Løngrundlag', [
    [('s','Konsulent e-mail'),('s','Periode'),('s','Beskrivelse'),('s','Timer'),('s','Timeløn'),('s','Ydelse')],
    [('s','sara@konsulent.dk'),('s','Maj 2026'),('s','Eventkoordinering uge 18-19'),('n',37.5),('n',520),('s','SalaryInvoicing')],
    [('s','erik@konsulent.dk'),('s','Maj 2026'),('s','Teknisk support og rigning'),('n',22),('n',455),('s','Excel-import')],
    [('s','sara@konsulent.dk'),('s','Maj 2026'),('s','Projektledelse'),('n',8),('n',610),('s','SalaryInvoicing')],
])

# ── 2. Norwegian, with a real date cell and messy values ─────────────────
build(os.path.join(OUT, 'no-messy.xlsx'), 'Lønnsgrunnlag', [
    [('s','Konsulent e-post'),('s','Periode'),('s','Beskrivelse'),('s','Timer'),('s','Timelønn'),('s','Tjeneste')],
    [('s','sara@konsulent.no'),('d',46143),('i','Frontend-utvikling'),('n',40),('n',890),('s','SalaryInvoicing')],
    [('s','UKJENT@konsulent.no'),('s','Mai 2026'),('s','Ukjent konsulent'),('n',10),('n',800),('s','SalaryInvoicing')],
    [('s','erik@konsulent.no'),('s','Mai 2026'),('s','Negative timer'),('n',-5),('n',680),('s','SalaryInvoicing')],
    [('s','erik@konsulent.no'),('s','Mai 2026'),('s',''),('n',12),('n',680),('s','SalaryInvoicing')],
    [None,None,None,None,None,None],
    [('s','erik@konsulent.no'),('s','Mai 2026'),('s','Ugyldig tjeneste'),('n',6),('n',680),('s','Ikke en tjeneste')],
])

# ── 3. Admin cross-company import ────────────────────────────────────────
build(os.path.join(OUT, 'dk-admin.xlsx'), 'Løngrundlag', [
    [('s','Virksomhed e-mail'),('s','Konsulent e-mail'),('s','Periode'),('s','Beskrivelse'),('s','Timer'),('s','Timeløn'),('s','Ydelse')],
    [('s','info@virksomhed.dk'),('s','sara@konsulent.dk'),('s','Maj 2026'),('s','Koordinering'),('n',30),('n',520),('s','SalaryInvoicing')],
    [('s','hr@prisjakt.dk'),('s','erik@konsulent.dk'),('s','Maj 2026'),('s','UX-analyse'),('n',18),('n',610),('s','API-integration')],
])

# ── 4. Rich-text + custom date format + column gaps ───────────────────────
build(os.path.join(OUT, 'dk-edge.xlsx'), 'Ark1', [
    [('s','Konsulent e-mail'),('s','Periode'),('s','Beskrivelse'),('s','Timer'),('s','Timeløn'),('s','Ydelse')],
    [('s','sara@konsulent.dk'),('d2',46143),('s','Tekst med "citat" & tegn <her>'),('n',7.25),('n',520.5),('s','SalaryInvoicing')],
])
