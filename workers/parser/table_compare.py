"""Fixed XLSX comparison recipe. No model code, network, formulas or workbook writes."""
import hashlib, json, posixpath, re, resource, sys, zipfile
from decimal import Decimal, localcontext, ROUND_HALF_UP
from pathlib import Path
from defusedxml.ElementTree import fromstring

resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
VERSION = 'table-compare-1'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

class Invalid(Exception): pass
def require(test, code):
    if not test: raise Invalid(code)

def column(value):
    require(isinstance(value, str) and re.fullmatch('[A-Z]{1,2}', value), 'INVALID_COLUMN')
    n = 0
    for c in value: n = n * 26 + ord(c) - 64
    require(n <= 200, 'COLUMN_LIMIT')
    return n

def coordinate(value):
    match = re.fullmatch(r'([A-Z]{1,2})([1-9][0-9]{0,4})', value or '')
    require(match is not None, 'INVALID_RANGE')
    row = int(match[2]); require(row <= 20000, 'ROW_LIMIT')
    return column(match[1]), row

def validate(request):
    keys = {'sheet', 'range', 'groupColumn', 'periodColumn', 'valueColumn', 'baseline', 'current'}
    require(isinstance(request, dict) and set(request) == keys, 'INVALID_REQUEST')
    require(isinstance(request['sheet'], str) and 0 < len(request['sheet']) <= 31, 'INVALID_SHEET')
    for key in ('baseline', 'current'):
        require(isinstance(request[key], str) and 0 < len(request[key]) <= 100, 'INVALID_PERIOD')
    require(request['baseline'] != request['current'], 'INVALID_PERIOD')
    parts = request['range'].split(':') if isinstance(request['range'], str) else []
    require(len(parts) == 2, 'INVALID_RANGE')
    c1, r1 = coordinate(parts[0]); c2, r2 = coordinate(parts[1])
    require(c1 <= c2 and 1 <= r2 - r1 <= 500 and c2 - c1 < 20, 'RANGE_LIMIT')
    cols = [column(request[k]) for k in ('groupColumn', 'periodColumn', 'valueColumn')]
    require(len(set(cols)) == 3 and all(c1 <= c <= c2 for c in cols), 'INVALID_COLUMN')
    return c1, r1, c2, r2

def workbook(path, request):
    c1, r1, c2, r2 = validate(request)
    require(path.stat().st_size <= 2_097_152, 'FILE_LIMIT')
    with zipfile.ZipFile(path) as z:
        files = z.infolist(); names = [f.filename for f in files]
        require(len(files) <= 1000 and len(set(names)) == len(names) and sum(f.file_size for f in files) <= 20_000_000, 'ZIP_LIMIT')
        for f in files:
            require(not f.flag_bits & 1 and f.file_size <= 8_000_000 and f.file_size <= max(100_000, f.compress_size * 200), 'ZIP_LIMIT')
        def xml(name): return fromstring(z.read(name))
        book = xml('xl/workbook.xml')
        sheets = [s for s in book.findall(f'{NS}sheets/{NS}sheet') if s.get('name') == request['sheet']]
        require(len(sheets) == 1, 'SHEET_NOT_FOUND')
        rels = [r for r in xml('xl/_rels/workbook.xml.rels') if r.get('Id') == sheets[0].get(RID)]
        require(len(rels) == 1 and rels[0].get('TargetMode') != 'External', 'INVALID_RELATIONSHIP')
        target = rels[0].get('Target', '')
        require('\\' not in target and ':' not in target, 'INVALID_RELATIONSHIP')
        target = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/' + target)
        require(target.startswith('xl/') and target in names, 'INVALID_RELATIONSHIP')
        strings = []
        if 'xl/sharedStrings.xml' in names:
            strings = [''.join(t.text or '' for t in list(si.findall(f'{NS}t')) + list(si.findall(f'{NS}r/{NS}t'))) for si in xml('xl/sharedStrings.xml')]
        root = xml(target); cells = {}; seen = set()
        for row in root.findall(f'{NS}sheetData/{NS}row'):
            for cell in row.findall(f'{NS}c'):
                ref = cell.get('r'); col, number = coordinate(ref)
                require(ref not in seen, 'DUPLICATE_CELL'); seen.add(ref)
                require(len(seen) <= 100000, 'CELL_LIMIT')
                if not (c1 <= col <= c2 and r1 <= number <= r2): continue
                kind = cell.get('t', 'n'); v = cell.find(f'{NS}v')
                value = None if v is None else v.text
                formula = cell.find(f'{NS}f') is not None
                if kind == 'inlineStr': value = ''.join(t.text or '' for t in list(cell.findall(f'{NS}is/{NS}t')) + list(cell.findall(f'{NS}is/{NS}r/{NS}t')))
                elif kind == 's':
                    require(value is not None and value.isdigit() and int(value) < len(strings), 'INVALID_STRING')
                    value = strings[int(value)]
                require(value is None or len(value) <= 1000, 'CELL_LIMIT')
                cells[ref] = {'value': value, 'kind': kind, 'formula': formula}
        for merge in root.findall(f'{NS}mergeCells/{NS}mergeCell'):
            left, right = merge.get('ref', '').split(':'); a,b = coordinate(left); c,d = coordinate(right)
            require(c < c1 or a > c2 or d < r1 or b > r2, 'MERGED_TABLE_RANGE')
    return cells

def number(cell, ref):
    require(cell is not None and cell['value'] not in (None, ''), 'MISSING_NUMBER:' + ref)
    require(not cell['formula'], 'FORMULA_NOT_SUPPORTED:' + ref)
    require(cell['kind'] in ('n', 's', 'inlineStr', 'str'), 'NON_NUMERIC_CELL:' + ref)
    raw = cell['value']
    require(re.fullmatch(r'-?[0-9]{1,30}(?:\.[0-9]{1,12})?(?:[Ee][+-]?[0-9]{1,2})?', raw) is not None, 'NON_NUMERIC_CELL:' + ref)
    v = Decimal(raw); require(v.is_finite() and abs(v) < Decimal('1e30') and v.as_tuple().exponent >= -12, 'NUMBER_LIMIT:' + ref)
    return v

def label(cell, ref):
    require(cell is not None and cell['value'] not in (None, ''), 'MISSING_LABEL:' + ref)
    require(not cell['formula'] and cell['kind'] in ('n', 's', 'inlineStr', 'str'), 'INVALID_LABEL:' + ref)
    require(len(cell['value']) <= 100, 'LABEL_LIMIT')
    return cell['value']

def decimal(v): return format(v, 'f') if v is not None else None

def compare(path, request):
    _, header, _, last = validate(request); cells = workbook(path, request)
    cols = [request[k] for k in ('groupColumn', 'periodColumn', 'valueColumn')]
    headers = {c: label(cells.get(f'{c}{header}'), f'{c}{header}') for c in cols}
    periods = [request['baseline'], request['current']]; groups = {}; rows = []; ignored = []; blank = []
    with localcontext() as ctx:
        ctx.prec = 80
        for row in range(header + 1, last + 1):
            refs = [f'{c}{row}' for c in cols]
            if all(cells.get(ref, {}).get('value') in (None, '') for ref in refs): blank.append(row); continue
            period = label(cells.get(refs[1]), refs[1])
            if period not in periods: ignored.append(row); continue
            group = label(cells.get(refs[0]), refs[0]); value = number(cells.get(refs[2]), refs[2])
            bucket = groups.setdefault(group, {}); bucket[period] = bucket.get(period, Decimal(0)) + value
            rows.append({'row': row, 'group': group, 'period': period, 'value': decimal(value), 'cell': refs[2]})
        require(groups and len(groups) <= 50 and all(any(p in g for g in groups.values()) for p in periods), 'NO_COMPARABLE_DATA')
        ranks = {}
        for period in periods:
            ordered = sorted(((k,v[period]) for k,v in groups.items() if period in v), key=lambda kv: (-kv[1], kv[0]))
            prior = None; rank = 0
            for i,(group,value) in enumerate(ordered, 1):
                if prior is None or value != prior: rank = i
                ranks[group,period] = rank; prior = value
        def result(group, values):
            before, after = (values.get(p) for p in periods)
            diff = after-before if before is not None and after is not None else None
            rate = (diff / before * 100).quantize(Decimal('.01'), rounding=ROUND_HALF_UP) if diff is not None and before > 0 else None
            return {'group':group, 'baseline':decimal(before), 'current':decimal(after), 'difference':decimal(diff), 'changePercent':decimal(rate), 'baselineRank':ranks.get((group,periods[0])), 'currentRank':ranks.get((group,periods[1])), 'issue':'MISSING_PERIOD' if diff is None else 'NON_POSITIVE_BASELINE' if before <= 0 else None}
        totals = {p:sum(v[p] for v in groups.values() if p in v) for p in periods}
        complete = all(all(p in v for p in periods) for v in groups.values())
        total = result(None, totals)
        if not complete: total.update(difference=None, changePercent=None, issue='UNEQUAL_GROUP_COVERAGE')
        output = {'recipeVersion':VERSION, 'status':'COMPUTED', 'request':request, 'headers':headers,
                  'method':{'aggregation':'sum by exact group and period within selected range only', 'rank':'descending competition rank; ties share rank', 'changePercent':'(current-baseline)/baseline*100, half-up 2 decimals; null for baseline<=0', 'blank':'missing values are not zero', 'coverage':'selected range, not proof of a complete business period or workbook'},
                  'matchedRows':len(rows), 'ignoredRows':ignored, 'blankRows':blank, 'inputs':rows,
                  'rows':[result(k,v) for k,v in groups.items()], 'totals':total,
                  'inputSha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        require(len(json.dumps(output,ensure_ascii=False).encode()) <= 50000, 'OUTPUT_LIMIT')
        return output

if __name__ == '__main__':
    try: result = compare(Path(sys.argv[1]), json.loads(Path(sys.argv[1]).with_name('request.json').read_text()))
    except Invalid as error: result = {'status':'FAILED', 'code':str(error)}
    except Exception: result = {'status':'FAILED', 'code':'INVALID_OR_UNSUPPORTED_WORKBOOK'}
    print(json.dumps(result, ensure_ascii=False))
