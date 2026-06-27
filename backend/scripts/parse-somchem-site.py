"""Parse saved somchemreload.com /search tables -> ManualLoad rows.
The powder/case/primer/barrel cells rowspan the WHOLE block of bullets they
cover, and the bullet (grain) cell rowspans its Start+Max pair — so the only
robust approach is FORWARD-FILL: carry each static value down until a new cell
for it appears. Charges assigned by CSS class (-load-start / -load-max), since
row order varies. LOAD DENSITY % = published case fill; V/C factor (vel/charge)
is ignored. COAL unit is per-table (inches -> x25.4)."""
import re, json, glob, os
from bs4 import BeautifulSoup

cals = dict(json.load(open('calibers.json')))
LABEL = 'Somchem — somchemreload.com'

def num(s):
    if not s:
        return None
    m = re.search(r'-?\d+(?:\.\d+)?', str(s).replace(' ', ''))
    return float(m.group(0)) if m else None

def by_class(tds, sub):
    for td in tds:
        if any(sub in c for c in (td.get('class') or [])):
            t = td.get_text(' ', strip=True)
            return t or None
    return None

rows = []
for path in sorted(glob.glob('somchem_site/f*.html')):
    fid = re.search(r'f(\d+)\.html', os.path.basename(path)).group(1)
    cartridge = cals.get(fid, '').strip()
    soup = BeautifulSoup(open(path, encoding='utf-8', errors='ignore').read(), 'lxml')
    for table in soup.select('table.views-table'):
        inches = 'inch' in table.get_text(' ', strip=True).lower()[:400]
        tbody = table.find('tbody', recursive=False)
        if not tbody:
            continue
        cur = {'powder': None, 'case': None, 'primer': None, 'barrel': None,
               'grain': None, 'coal': None}
        groups = {}
        order = []
        for tr in tbody.find_all('tr', recursive=False):
            tds = tr.find_all('td', recursive=False)
            if not tds:
                continue
            # Forward-fill static cells (each only appears on the first row it spans).
            p = by_class(tds, 'field-propellant')
            if p:
                cur['powder'] = p
            for k, sub in (('case', 'field-case'), ('primer', 'field-primer'),
                           ('barrel', 'field-barrel-length')):
                v = by_class(tds, sub)
                if v:
                    cur[k] = v
            grain = by_class(tds, 'field-grain')
            if grain:
                cur['grain'] = grain
                # COAL = the non-class numeric cell on this (grain) row.
                coal = None
                for td in tds:
                    cl = ' '.join(td.get('class') or [])
                    if 'views-field-field-' in cl:
                        continue
                    tx = td.get_text(' ', strip=True)
                    if tx in ('Start', 'Max'):
                        continue
                    if coal is None and re.search(r'\d', tx):
                        coal = num(tx)
                cur['coal'] = coal
            ls, lsv = num(by_class(tds, 'field-load-start')), num(by_class(tds, 'field-velocity-start'))
            lm, lmv = num(by_class(tds, 'field-load-max')), num(by_class(tds, 'field-velocity-max'))
            dens = num(by_class(tds, 'field-load-density'))
            if not cur['powder'] or not cur['grain']:
                continue
            key = (cur['powder'], cur['grain'], cur['case'], cur['primer'], cur['barrel'])
            if key not in groups:
                groups[key] = {'coal': cur['coal'], 'fill': None, 'loads': {}}
                order.append(key)
            g = groups[key]
            if ls is not None:
                g['loads']['start'] = (ls, lsv)
            if lm is not None:
                g['loads']['max'] = (lm, lmv)
            if dens is not None and g['fill'] is None:
                g['fill'] = dens
        for key in order:
            powder, grain, case, primer, barrel = key
            g = groups[key]
            st, mx = g['loads'].get('start'), g['loads'].get('max')
            if not st and not mx:
                continue
            s_gr, s_v = st or mx
            m_gr, m_v = mx or st
            mw = re.search(r'(\d+(?:\.\d+)?)\s*gr\b', grain or '', re.I)
            bw = num(mw.group(1)) if mw else None
            bname = re.sub(r'\d+(?:\.\d+)?\s*gr\b', '', grain or '', flags=re.I).strip().strip('"').strip("'").strip() or None
            pn = re.sub(r'\s*(see note|note\s*\d*).*$', '', powder, flags=re.I)
            pn = re.sub(r'[*†‡\s]+$', '', pn).strip()
            coal = g['coal'] * 25.4 if (inches and g['coal'] and g['coal'] < 6) else g['coal']
            coal = round(coal, 1) if (coal and 20 <= coal <= 120) else None
            fill = g['fill'] if (g['fill'] and 1 <= g['fill'] <= 200) else None
            if not (bw and 10 <= bw <= 1000):  # need a real bullet weight (drops shot loads)
                continue
            if not (s_gr and m_gr and 0 < s_gr <= m_gr <= 300):
                continue
            rows.append({
                'cartridge': cartridge, 'powderMaker': 'Somchem', 'powderName': pn,
                'bulletMaker': None, 'bulletName': bname, 'bulletWeightGr': bw,
                'startGr': s_gr, 'maxGr': m_gr,
                'startVelFps': int(s_v) if s_v else None, 'maxVelFps': int(m_v) if m_v else None,
                'coalMm': coal, 'primer': primer, 'caseMaker': case, 'barrelLenIn': num(barrel),
                'fillPctStart': None, 'fillPctMax': fill, 'manualLabel': LABEL, 'page': 0,
            })

with open('somchem_site_rows.jsonl', 'w', encoding='utf-8') as w:
    for r in rows:
        w.write(json.dumps(r, ensure_ascii=False) + '\n')

import collections
c = collections.Counter(r['cartridge'] for r in rows)
print(f"rows {len(rows)} | cartridges {len(c)} | powders {sorted(set(r['powderName'] for r in rows))}")
print('powderName None:', sum(1 for r in rows if not r['powderName']), '| with fill:', sum(1 for r in rows if r['fillPctMax']))
print('.308:', c.get('.308 Winchester'), '| .223:', c.get('.223 Remington'), '| 6.5CM:', c.get('6.5mm Creedmoor'))
for r in rows:
    if 'Creedmoor' in (r['cartridge'] or ''):
        print(f"  {r['powderName']} {r['bulletWeightGr']}gr {r['bulletName']} {r['startGr']}-{r['maxGr']}gr {r['startVelFps']}-{r['maxVelFps']}fps")
