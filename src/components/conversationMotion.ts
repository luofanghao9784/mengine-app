export type BriefingVisual = { element: HTMLElement; rect: DOMRect };

export const captureDraftVisual = (source: HTMLElement) => captureVisual(source, false);
export const captureBriefingVisual = (source: HTMLElement) => captureVisual(source, true);

// Freeze the rendered card before navigation changes its hover state, layout or chat badge.
// Keeping the grid context also preserves pseudo-elements such as the news-photo gradient.
function captureVisual(source: HTMLElement, briefing: boolean): BriefingVisual {
  const rect = source.getBoundingClientRect();
  const copy = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement | SVGElement>('*')];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement | SVGElement>('*')];
  originals.forEach((node, index) => {
    const clone = copies[index];
    const style = getComputedStyle(node);
    for (const property of style) clone.style.setProperty(property, style.getPropertyValue(property));
    clone.style.animation = 'none';
    clone.style.transition = 'none';
    clone.style.visibility = 'visible';
    clone.removeAttribute('id');
    clone.removeAttribute('data-card-id');
    clone.removeAttribute('autofocus');
    clone.removeAttribute('aria-label');
    clone.removeAttribute('aria-labelledby');
    if (clone instanceof HTMLImageElement) clone.loading = 'eager';
    if (node instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) clone.value = node.value;
    if (node.classList.contains('briefing-news-photo')) {
      const shade = document.createElement('span');
      const pseudo = getComputedStyle(node, '::after');
      for (const property of pseudo) shade.style.setProperty(property, pseudo.getPropertyValue(property));
      shade.className = 'conversation-photo-shade';
      clone.append(shade);
    }
  });
  Object.assign(copy.style, {
    position: 'relative',
    inset: 'auto',
    margin: '0',
    transform: 'none',
    translate: 'none',
    gridArea: 'auto',
  });
  const element = document.createElement('div');
  element.className = `${briefing ? 'briefing-grid ' : ''}conversation-morph-layout`;
  Object.assign(element.style, {
    position: 'absolute',
    inset: '0 auto auto 0',
    display: 'block',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    padding: '0',
    transformOrigin: 'top left',
  });
  element.inert = true;
  element.append(copy);
  return { element, rect };
}

const layoutProperties = [
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
  'font-size',
  'line-height',
  'letter-spacing',
  'color',
  'background-color',
  'border-color',
  'border-width',
  'border-radius',
  'box-shadow',
  'text-shadow',
  'opacity',
  'top',
  'right',
  'bottom',
  'left',
  'transform',
  'position',
  'display',
  'flex-direction',
  'align-items',
  'align-self',
  'justify-content',
  'flex-basis',
  'flex-grow',
  'flex-shrink',
  'order',
  '-webkit-line-clamp',
  'white-space',
];

// Match the source content to its real message-card layout. At handoff the two
// surfaces align, so labels and charts cannot appear twice at different positions.
function matchContent(
  copy: HTMLElement | SVGElement,
  target: Element,
  animate: (element: Element, from: Keyframe, to: Keyframe) => Animation,
): Animation[] {
  const style = getComputedStyle(target);
  const from: Record<string, string> = {};
  const to: Record<string, string> = {};
  layoutProperties.forEach((property) => {
    const key = property.replace(/^-/, '').replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    from[key] = copy.style.getPropertyValue(property);
    to[key] = style.getPropertyValue(property);
  });
  // A borderless source preview reports its text color as the border color.
  // Fade the stroke away instead of briefly drawing a dark outline in transit.
  if (style.borderStyle === 'none' || style.borderWidth === '0px') to.borderColor = 'transparent';
  if (copy.style.display === 'none' && style.display !== 'none') {
    copy.style.display = style.display;
    from.display = style.display;
    from.opacity = '0';
    from.height = '0px';
    from.width = to.width;
  }
  const animations = [animate(copy, from, to)];
  const used = new Set<Element>();
  for (const child of Array.from(copy.children) as (HTMLElement | SVGElement)[]) {
    const match = Array.from(target.children).find(
      (candidate) =>
        !used.has(candidate) &&
        candidate.getAttribute('class') === child.getAttribute('class') &&
        (candidate.tagName === child.tagName || child.classList.contains('briefing-card-main')),
    );
    if (match) {
      used.add(match);
      animations.push(...matchContent(child, match, animate));
    } else animations.push(animate(child, { opacity: child.style.opacity }, { opacity: 0 }));
  }
  return animations;
}

// The live conversation stays still beneath the snapshot. Reverse the same frames
// for closing, and reveal the conversation only after its reference card lines up.
export function animateBriefingMorph(
  surface: HTMLElement,
  conversation: HTMLElement,
  visual: BriefingVisual,
  target: DOMRect,
  duration: number,
  closing = false,
): Animation[] {
  const { rect, element } = visual;
  surface.replaceChildren(element);
  surface.style.display = 'block';
  const from = {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
  const to = {
    left: `${target.left}px`,
    top: `${target.top}px`,
    width: `${target.width}px`,
    height: `${target.height}px`,
  };
  const reference = conversation.querySelector<HTMLElement>(
    '[data-current-origin] .briefing-reference > .briefing-card, .deck-source-scroll > .briefing-card, .new-conversation-composer .draft-composer',
  );
  const referenceRect = reference?.getBoundingClientRect();
  const contentTransform = referenceRect?.width
    ? `translate(${referenceRect.left - target.left}px, ${referenceRect.top - target.top}px)`
    : `scale(${target.width / rect.width})`;
  const travelEnd = 0.76;
  const options: KeyframeAnimationOptions = {
    duration,
    fill: 'both',
    direction: closing ? 'reverse' : 'normal',
  };
  const move = (node: Element, from: Keyframe, to: Keyframe) =>
    node.animate(
      [
        { ...from, offset: 0, easing: 'cubic-bezier(.22,.8,.2,1)' },
        { ...to, offset: travelEnd },
        { ...to, offset: 1 },
      ],
      options,
    );
  const animations = [
    surface.animate(
      [
        { ...from, opacity: 1, offset: 0, easing: 'cubic-bezier(.22,.8,.2,1)' },
        { ...to, opacity: 1, offset: travelEnd },
        { ...to, opacity: 0, offset: 1 },
      ],
      options,
    ),
    move(element, { transform: 'none' }, { transform: contentTransform }),
    conversation.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: travelEnd - 0.002 },
        { opacity: 1, offset: travelEnd, easing: 'steps(1, end)' },
        { opacity: 1, offset: 1 },
      ],
      options,
    ),
  ];
  if (reference && referenceRect?.width) {
    animations.push(...matchContent(element.firstElementChild as HTMLElement, reference, move));
  }
  return animations;
}
