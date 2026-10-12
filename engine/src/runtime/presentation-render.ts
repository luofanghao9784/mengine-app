import pptxgen from 'pptxgenjs';
import { parseDeck, type DeckSpec } from './presentation-spec.js';
export const PRESENTATION_RECIPE = 'dreamcore-pptx/1.0.0';
export const PRESENTATION_FONT = 'Noto Sans CJK SC';
export async function renderPresentation(input: DeckSpec, references: Record<string, string> = {}) {
  const spec = parseDeck(input),
    pptx = new (pptxgen as unknown as typeof pptxgen.default)();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = '梦擎';
  pptx.subject = '梦擎办公演示文稿';
  pptx.title = spec.title;
  pptx.theme = { headFontFace: PRESENTATION_FONT, bodyFontFace: PRESENTATION_FONT };
  const theme =
    spec.theme === 'ocean'
      ? { primary: '143B4A', accent: '007F86', light: 'E4F0EF', bg: 'FAFCFC' }
      : { primary: '22223B', accent: '635A8D', light: 'ECEAF2', bg: 'FAF9FC' };
  const text = (size: number, color = theme.primary) => ({
    fontFace: PRESENTATION_FONT,
    fontSize: size,
    color,
    margin: 0,
    breakLine: false,
  });
  for (const [index, s] of spec.slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: s.kind === 'cover' ? theme.primary : theme.bg };
    slide.addNotes(
      (s.sourceIds.length
        ? s.sourceIds.map((id) => references[id] ?? id)
        : ['本页未标注空间资料引用。请核对内容及数据依据。']
      ).join('\n'),
    );
    if (s.kind === 'cover') {
      slide.addText(s.title, {
        ...text(36, 'FFFFFF'),
        x: 0.75,
        y: 2,
        w: 11.8,
        h: 1.5,
        bold: true,
        valign: 'middle',
      });
      if (s.subtitle)
        slide.addText(s.subtitle, { ...text(19, 'DFEAEB'), x: 0.8, y: 4.0, w: 11.6, h: 1.2, valign: 'top' });
      continue;
    }
    slide.addText(s.title, { ...text(28), x: 0.65, y: 0.45, w: 12, h: 0.85, bold: true });
    slide.addShape(pptx.ShapeType.line, {
      x: 0.65,
      y: 1.45,
      w: 12,
      h: 0,
      line: { color: theme.accent, width: 1 },
    });
    slide.addText(String(index + 1), { ...text(11), x: 12, y: 7.02, w: 0.55, h: 0.22, align: 'right' });
    if (s.kind === 'bullets') {
      for (const [i, line] of s.bullets!.entries())
        slide.addText(line, {
          ...text(21),
          x: 0.9,
          y: 1.9 + i * 1.1,
          w: 11.6,
          h: 0.9,
          valign: 'middle',
          bullet: { indent: 18 },
          paraSpaceAfter: 12,
        });
    } else if (s.kind === 'table') {
      slide.addTable(
        [
          s.headers!.map((t) => ({
            text: t,
            options: { bold: true, color: 'FFFFFF', fill: { color: theme.primary } },
          })),
          ...s.rows!.map((row) => row.map((text) => ({ text }))),
        ],
        {
          x: 0.65,
          y: 1.8,
          w: 12,
          h: 4.7,
          colW: Array(s.headers!.length).fill(12 / s.headers!.length),
          rowH: 0.62,
          border: { type: 'solid', color: 'CBD8DC', pt: 0.5 },
          fontFace: PRESENTATION_FONT,
          fontSize: s.headers!.length === 5 ? 13 : 15,
          color: theme.primary,
          fill: { color: 'FFFFFF' },
          margin: 0.1,
          valign: 'middle',
          autoPage: false,
        },
      );
    } else if (s.kind === 'chart') {
      slide.addChart(pptx.ChartType.bar, [{ name: s.series!, labels: s.labels!, values: s.values! }], {
        x: 0.65,
        y: 1.8,
        w: 12,
        h: 4.85,
        catAxisLabelFontFace: PRESENTATION_FONT,
        catAxisLabelFontSize: 14,
        valAxisLabelFontFace: PRESENTATION_FONT,
        valAxisLabelFontSize: 12,
        chartColors: [theme.accent],
        showLegend: false,
        showTitle: true,
        title: `${s.series}（${s.unit}）`,
        titleFontFace: PRESENTATION_FONT,
        titleFontSize: 16,
        showValue: true,
        dataLabelPosition: 'outEnd',
        dataLabelColor: theme.primary,
        dataLabelFormatCode: 'General',
        catAxisLineShow: false,
        valAxisLineShow: false,
      });
    }
  }
  return new Uint8Array((await pptx.write({ outputType: 'uint8array', compression: true })) as Uint8Array);
}
