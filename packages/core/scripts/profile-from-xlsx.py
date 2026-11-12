#!/usr/bin/env python3
"""Turn a publisher's style list (.xlsx) into a tag profile (JSON).

Usage: python3 -I scripts/profile-from-xlsx.py "Style List.xlsx" > ~/.book-core/profiles/<house>.json

Reads one common sheet layout: a Topics table
(name | Word style | abbreviation), then paragraph styles
(element | Word style | topic prefix | InDesign style | FMLO), then character
styles. Hand-maintained additions live in profiles/<name>.extra.json and are
merged by the pipeline, so re-running this never loses them.
"""
import json, re, sys, zipfile
import xml.etree.ElementTree as ET

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def rows(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(M + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(M + 't')))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target = {r.get('Id'): r.get('Target') for r in rels}
    first = wb.find(M + 'sheets')[0]
    sheet = ET.fromstring(z.read('xl/' + target[first.get(R + 'id')].lstrip('/').replace('xl/', '')))
    for row in sheet.iter(M + 'row'):
        cells = {}
        for c in row.findall(M + 'c'):
            v = c.find(M + 'v')
            if c.get('t') == 's' and v is not None:
                val = shared[int(v.text)]
            elif c.get('t') == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter(M + 't'))
            else:
                val = v.text if v is not None else ''
            col = 0
            for ch in re.match(r'[A-Z]+', c.get('r')).group():
                col = col * 26 + ord(ch) - 64
            cells[col - 1] = (val or '').strip()
        yield [cells.get(i, '') for i in range(max(cells) + 1)] if cells else []


def main(path):
    topics, paragraph, character = {}, {}, {}
    section = None
    for r in rows(path):
        r = (r[1:] if r else []) + [''] * 9  # column A is empty in this layout
        head = r[0]
        if head == 'Topics':
            section = 'topics'; continue
        if head == 'Structural Element':
            section = 'para'; continue
        if head == 'Element' and 'Character' in r[2]:
            section = 'char'; continue
        if not any(r) or r[2] == 'Style Name':
            continue
        if section == 'topics' and r[2].startswith('topic-'):
            topics[r[2]] = {'name': head, 'abbr': r[4] or None}
        elif section == 'para' and r[2] and not r[2].startswith('n/a'):
            word = r[2]
            idd = r[5]
            container = bool(re.search(r'-[is]$', word))
            # "(+ expl)" in the label means explicit first/middle/last/only styles exist.
            expl = '+ expl' in head.replace('(+expl)', '(+ expl)')
            entry = {'label': head, 'fmlo': 'first' in r[6] or idd.endswith('_') or expl}
            if container:
                entry['container'] = 'internal' if word.endswith('-i') else 'separate'
            if r[4].startswith('n/a') or word in ('end', 'skip'):
                entry['emit'] = False
            if idd and '\n' not in idd and '/' not in idd and '<style>' not in idd:
                base = idd.rstrip('_').strip()
                if base and base != word:
                    entry['indesign'] = base  # spreadsheet's InDesign spelling
            if r[7]:
                entry['note'] = r[7]
            paragraph.setdefault(word, entry)
        elif section == 'char' and r[2] and r[5] and not r[5].startswith('n/a'):
            entry = {'label': head}
            if r[5] != r[2]:
                entry['indesign'] = r[5]
            character.setdefault(r[2], entry)
    json.dump({
        'name': sys.argv[2] if len(sys.argv) > 2 else 'House',
        'source': path.split('/')[-1],
        'topics': topics,
        'paragraph': paragraph,
        'character': character,
    }, sys.stdout, indent=1, ensure_ascii=False)
    print()


main(sys.argv[1])
