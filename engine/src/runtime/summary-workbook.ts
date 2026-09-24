/** Release-owned XLSX result snapshot; no formulas, macros, links, or arbitrary cell expressions. */
export interface CsvSummary {
  headers: string[];
  totalRows: number;
  matchedRows: number;
  operation: 'count' | 'sum';
  numericRows: number;
  skippedBlankNumbers: number;
  total: string | null;
  groups: {
    key: string | null;
    rows: number;
    numericRows: number;
    skippedBlankNumbers: number;
    total: string | null;
  }[];
}
export interface RecipeProvenance {
  filename: string;
  version: number;
  versionId: string;
  materialId: string;
  inputSha256: string;
  inputBytes: number;
  recipeVersion: string;
  options: Record<string, unknown>;
}

// Self-contained function: copied into the task sandbox together with the computation.
export function summaryWorkbook(
  summary: CsvSummary,
  source: RecipeProvenance,
  compress: (bytes: Buffer) => Buffer,
): Buffer {
  const xml = (value: string) => {
    if (
      [...value]
        .map((c) => c.codePointAt(0)!)
        .some(
          (c) =>
            (c < 32 && ![9, 10, 13].includes(c)) ||
            (c >= 0xd800 && c <= 0xdfff) ||
            c === 0xfffe ||
            c === 0xffff,
        )
    )
      throw Error('DATA');
    return value
      .replace(/_x[0-9a-f]{4}_/gi, (m) => '_x005F_' + m.slice(1))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\r/g, '&#13;');
  };
  type Cell = { value: string | number; style?: number; numeric?: boolean };
  const text = (value: unknown, style = 0): Cell => ({ value: String(value ?? ''), style });
  const number = (value: number): Cell => ({ value, numeric: true, style: 3 });
  const decimal = (value: string | null): Cell =>
    value === null
      ? text('—')
      : value.replace(/[-.]/g, '').replace(/^0+/, '').length <= 15
        ? { value, numeric: true, style: 4 }
        : text(value, 5);
  const row = (n: number, cells: Cell[], height = 26) =>
    `<row r="${n}" ht="${height}" customHeight="1">${cells
      .map((c, i) => {
        const ref = String.fromCharCode(65 + i) + n;
        return c.numeric
          ? `<c r="${ref}" s="${c.style || 0}"><v>${c.value}</v></c>`
          : `<c r="${ref}" s="${c.style || 0}" t="inlineStr"><is><t xml:space="preserve">${xml(String(c.value))}</t></is></c>`;
      })
      .join('')}</row>`;
  // Wrap by approximate displayed width, retaining long identifiers and literal multi-line group labels.
  const height = (value: string, width: number) =>
    Math.max(
      26,
      value
        .split(/\r\n?|\n/)
        .reduce(
          (n, s) =>
            n +
            Math.max(1, Math.ceil([...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0) / width)),
          0,
        ) *
        16 +
        8,
    );
  const groupRows = summary.groups.map((g, i) => {
    const label = g.key === null ? '全部匹配记录' : g.key;
    const h = height(label, 32);
    if (h > 400) throw Error('LIMIT');
    return row(
      11 + i,
      [
        text(label),
        number(g.rows),
        summary.operation === 'sum' ? number(g.numericRows) : text('—'),
        summary.operation === 'sum' ? number(g.skippedBlankNumbers) : text('—'),
        decimal(g.total),
      ],
      Math.max(h, height(g.total || '', 45)),
    );
  });
  const rows = [
    row(1, [text('表格统计结果', 1)], 34),
    row(2, [text('固定版本结果快照 · 修改此文件不会重新计算或更新原资料', 6)], 26),
    row(
      4,
      [
        text('统计方式', 2),
        text(summary.operation === 'sum' ? '求和' : '计数'),
        text('统计列', 2),
        text(summary.operation === 'sum' ? source.options.column : '—'),
      ],
      Math.max(26, height(String(summary.operation === 'sum' ? source.options.column : ''), 24)),
    ),
    row(5, [
      text('原件数据行数', 2),
      number(summary.totalRows),
      text('匹配行数', 2),
      number(summary.matchedRows),
    ]),
    row(6, [
      text('参与求和行数', 2),
      summary.operation === 'sum' ? number(summary.numericRows) : text('—'),
      text('跳过空值行数', 2),
      summary.operation === 'sum' ? number(summary.skippedBlankNumbers) : text('—'),
    ]),
    row(
      8,
      [
        text(summary.operation === 'sum' ? '精确合计' : '匹配记录数', 2),
        summary.operation === 'sum' ? decimal(summary.total) : number(summary.matchedRows),
      ],
      30,
    ),
    row(
      10,
      ['分组', '匹配行数', '参与求和行数', '跳过空值行数', '精确合计'].map((v) => text(v, 2)),
      34,
    ),
    ...groupRows,
    ...(!groupRows.length ? [row(11, [text('无匹配记录；未生成分组。')], 30)] : []),
  ];
  const details: [string, unknown][] = [
    ['原件', source.filename],
    ['原件版本', source.version],
    ['原件版本 ID', source.versionId],
    ['资料 ID', source.materialId],
    ['原件 SHA-256', source.inputSha256],
    ['原件字节数', source.inputBytes],
    ['配方版本', source.recipeVersion],
    ['统计方式', summary.operation === 'sum' ? 'sum（精确十进制求和）' : 'count（匹配记录计数）'],
    ['统计列', summary.operation === 'sum' ? source.options.column : '不适用'],
    ['分组列', source.options.groupBy ?? '未分组'],
    ['筛选列', source.options.filterColumn ?? '未筛选'],
    ['筛选值（完整匹配）', source.options.filterValue ?? '不适用'],
    ['分隔符', source.options.delimiter === '\t' ? '制表符' : (source.options.delimiter ?? ',')],
    [
      '求和空值处理',
      summary.operation !== 'sum'
        ? '不适用'
        : source.options.blankNumbers === 'skip'
          ? '跳过并记录数量'
          : '拒绝',
    ],
    [
      '计算说明',
      '统计覆盖所选原件的全部数据行；结果由工具计算，模型不填写数值。分组保持原件首次出现顺序；空分组保持空白。',
    ],
    [
      '数字精度',
      '合计超过 Excel 的 15 位有效数字时以文本保留精确值；计数和其余合计为数值。所有分组名称均按文字保存。',
    ],
    [
      '使用说明',
      '本文件是不可变任务结果的下载副本，不是联动计算模板。重新计算需对明确的原件版本发起任务。无公式、宏或外部链接。',
    ],
  ];
  const detailRows = [
    row(1, [text('来源与统计口径', 1)], 34),
    ...details.map(([label, value], i) => {
      const h = Math.max(height(label, 28), height(String(value), 90));
      if (h > 400) throw Error('LIMIT');
      return row(i + 3, [text(label, 2), typeof value === 'number' ? number(value) : text(value)], h);
    }),
  ];
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const sheet = (content: string[], columns: number[], last: number, summarySheet: boolean) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><dimension ref="A1:${summarySheet ? 'E' : 'B'}${last}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0">${summarySheet ? '<pane ySplit="10" topLeftCell="A11" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A11" sqref="A11"/>' : ''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="26"/><cols>${columns.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${content.join('')}</sheetData>${summarySheet && groupRows.length ? `<autoFilter ref="A10:E${10 + groupRows.length}"/>` : ''}<mergeCells count="${summarySheet ? 3 : 1}"><mergeCell ref="A1:${summarySheet ? 'E' : 'B'}1"/>${summarySheet ? '<mergeCell ref="A2:E2"/><mergeCell ref="B8:E8"/>' : ''}</mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const font = (bold = false, color = '334155', size = 11) =>
    `<font><sz val="${size}"/><color rgb="FF${color}"/><name val="Noto Sans CJK SC"/>${bold ? '<b/>' : ''}</font>`;
  const xf = (fontId: number, fill: number, format: number, align = 'left') =>
    `<xf numFmtId="${format}" fontId="${fontId}" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment vertical="center" horizontal="${align}" wrapText="1"/></xf>`;
  const parts: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
    [
      'xl/workbook.xml',
      `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="汇总" sheetId="1" r:id="rId1"/><sheet name="来源与口径" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ],
    [
      'xl/styles.xml',
      `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.############"/></numFmts><fonts count="3">${font()}${font(true, '1E3A5F', 18)}${font(true)}</fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7">${xf(0, 0, 0)}${xf(1, 0, 0)}${xf(2, 2, 0)}${xf(0, 0, 3, 'right')}${xf(0, 0, 164, 'right')}${xf(0, 0, 49, 'right')}${xf(0, 0, 0)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ],
    [
      'xl/worksheets/sheet1.xml',
      sheet(rows, [34, 20, 23, 25, 48], Math.max(11, 10 + groupRows.length), true),
    ],
    ['xl/worksheets/sheet2.xml', sheet(detailRows, [30, 94], details.length + 2, false)],
  ];
  // A bounded deterministic ZIP container; filenames/relationships are all fixed release-owned strings.
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let j = 0; j < 8; j++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const files: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const [path, content] of parts) {
    const name = Buffer.from(path),
      bytes = Buffer.from(content),
      packed = compress(bytes),
      checksum = crc(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    files.push(local, name, packed);
    directory.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const end = Buffer.alloc(22),
    table = Buffer.concat(directory);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(table.length, 12);
  end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...files, table, end]);
  if (result.length > 24000) throw Error('LIMIT');
  return result;
}
