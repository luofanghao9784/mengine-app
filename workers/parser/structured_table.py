"""Strict admission, independent of lossy document chunks. Never evaluates formulas."""
import csv, io, json, re, zipfile
from datetime import date, datetime

class Rejected(Exception):
    pass

def reject(reason):
    raise Rejected(reason)

def extract(path, extension):
    if extension not in ('csv', 'tsv', 'xlsx', 'xls'):
        return None
    try:
        if path.stat().st_size > 20_971_520:
            reject('FILE_TABLE_LIMIT')
        if extension == 'xls':
            reject('FILE_TABLE_LEGACY_XLS')
        if extension in ('csv', 'tsv'):
            try:
                text = path.read_bytes().decode('utf-8-sig', errors='strict')
            except UnicodeError:
                reject('FILE_TABLE_ENCODING')
            csv.field_size_limit(2001)
            rows = csv.reader(io.StringIO(text, newline=''), delimiter='\t' if extension == 'tsv' else ',', strict=True)
            result = validate(rows)
        else:
            result = excel(path)
        # Keep the sandbox protocol safely below its output limit, including document chunks.
        if len(json.dumps(result, ensure_ascii=False).encode('utf-8')) > 1_500_000:
            reject('FILE_TABLE_LIMIT')
        return result
    except Rejected as error:
        return {'state': 'DOCUMENT_ONLY', 'reason': str(error), 'columns': [], 'rows': [], 'types': []}
    except Exception:
        return {'state': 'DOCUMENT_ONLY', 'reason': 'FILE_TABLE_INVALID', 'columns': [], 'rows': [], 'types': []}

def validate(iterator):
    columns, rows, size = None, [], 0
    for row in iterator:
        row = list(row)
        # Entirely blank lines are ignored; individual blank cells are preserved.
        if not any(v.strip() for v in row):
            continue
        if any(len(v) > 2000 or any(ord(c) < 32 and c not in '\n\r\t' for c in v) for v in row):
            reject('FILE_TABLE_CELL_INVALID')
        size += sum(len(v.encode('utf-8')) for v in row)
        if size > 1_000_000:
            reject('FILE_TABLE_LIMIT')
        if columns is None:
            columns = [v.strip() for v in row]
            if not 1 <= len(columns) <= 30 or any(not v or len(v) > 50 or '\n' in v or '\r' in v or '\t' in v for v in columns):
                reject('FILE_TABLE_HEADER_INVALID')
            if all(re.fullmatch(r'[-+\d.,%/ :]+', v) for v in columns):
                reject('FILE_TABLE_HEADER_INVALID')
            if len(set(v.casefold() for v in columns)) != len(columns):
                reject('FILE_TABLE_HEADER_DUPLICATE')
        else:
            if len(row) != len(columns):
                reject('FILE_TABLE_NON_RECTANGULAR')
            if [v.strip() for v in row] == columns or any(re.match(r'^(合计|总计|小计|total|subtotal)$', v.strip(), re.I) for v in row):
                reject('FILE_TABLE_REPORT_LAYOUT')
            rows.append(row)
            if len(rows) > 10_000:
                reject('FILE_TABLE_LIMIT')
    if columns is None or not rows:
        reject('FILE_TABLE_EMPTY')
    types = []
    for index, name in enumerate(columns):
        values = [r[index] for r in rows if r[index] != '']
        kind = 'text'
        # Identifiers and leading zeros stay strings; no speculative business units.
        if values and not re.search(r'id|编号|编码|号码|电话|手机|账号|邮编', name, re.I):
            if all(re.fullmatch(r'-?(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?', v) for v in values):
                kind = 'number'
            elif all(v in ('true', 'false') for v in values):
                kind = 'boolean'
            elif all(valid_date(v) for v in values):
                kind = 'date'
        types.append(kind)
    return {'state': 'READY', 'reason': 'FILE_TABLE_VALIDATED', 'columns': columns, 'rows': rows, 'types': types}

def valid_date(value):
    try:
        return bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', value)) and date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False

def excel(path):
    with zipfile.ZipFile(path) as archive:
        files = archive.infolist()
        if len(files) > 3000 or sum(x.file_size for x in files) > 40_000_000:
            reject('FILE_TABLE_LIMIT')
        for entry in files:
            if entry.flag_bits & 1 or entry.file_size > 12_000_000 or entry.file_size > max(100_000, entry.compress_size * 200):
                reject('FILE_TABLE_LIMIT')
            if entry.filename.endswith(('.xml', '.rels')):
                body = archive.read(entry).upper()
                if b'<!DOCTYPE' in body or b'<!ENTITY' in body:
                    reject('FILE_TABLE_INVALID')
                if entry.filename.startswith('xl/worksheets/') and (b'<MERGECELL' in body or b'<AUTOFILTER' in body or b'HIDDEN="1"' in body or b'HIDDEN="TRUE"' in body):
                    reject('FILE_TABLE_REPORT_LAYOUT')
            if any(x in entry.filename for x in ('externalLinks/', 'drawings/', 'charts/', 'pivotTables/', 'vbaProject')):
                reject('FILE_TABLE_REPORT_LAYOUT')
    import openpyxl
    book = openpyxl.load_workbook(io.BytesIO(path.read_bytes()), read_only=True, data_only=False, keep_links=False)
    try:
        if len(book.worksheets) != 1 or book.worksheets[0].sheet_state != 'visible':
            reject('FILE_TABLE_MULTIPLE_SHEETS')
        sheet = book.worksheets[0]
        sheet.reset_dimensions()  # Never trust truncated worksheet dimensions.
        def strings():
            for index, cells in enumerate(sheet.iter_rows()):
                if index > 10_000 or len(cells) > 30:
                    reject('FILE_TABLE_LIMIT')
                row = []
                for cell in cells:
                    value = cell.value
                    if cell.data_type in ('f', 'e'):
                        reject('FILE_TABLE_FORMULA_OR_ERROR')
                    if value is None:
                        row.append('')
                    elif isinstance(value, bool):
                        row.append(str(value).lower())
                    elif isinstance(value, (date, datetime)):
                        row.append(value.isoformat())
                    elif isinstance(value, (int, float)):
                        # Excel numeric storage/display can erase zeros, percent/units and precision.
                        # Only General/raw numeric formats are admitted automatically.
                        if cell.number_format not in ('General', '0', '0.00', '0.0', '0.000', '0.0000'):
                            reject('FILE_TABLE_NUMBER_FORMAT')
                        if not re.fullmatch(r'-?\d{1,15}(?:\.\d{1,6})?', str(value)) or len(str(value).replace('-', '').replace('.', '').lstrip('0')) > 15:
                            reject('FILE_TABLE_NUMBER_PRECISION')
                        row.append(str(value))
                    else:
                        row.append(str(value))
                yield row
        return validate(strings())
    finally:
        book.close()
