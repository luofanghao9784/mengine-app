import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Newspaper } from 'lucide-react';
import type {
  BriefingCard,
  BriefingDay,
  BriefingPage,
  BriefingTimelinePage,
} from '../../contracts/public-api/briefing';
import { briefingClient } from './client';
import { MagazineGrid } from './MagazineGrid';
import { BriefingFeedTail, useInfiniteBriefing } from './useInfiniteBriefing';
import { RequestPending } from '../shared/request-guard';
import { Failure, Loading } from '../shared/admin';
import { Empty } from '../shared/ui';
import './date-timeline.css';

type Feed = ReturnType<typeof useInfiniteBriefing<BriefingTimelinePage>>;
const identity = (card: BriefingCard) => card.cardId || card.taskId;
export function DateTimeline({
  tenant,
  zone,
  feed,
  revision,
  renderCard,
  onMonthChange,
}: {
  tenant: string;
  zone: string;
  feed: Feed;
  revision: number;
  renderCard: (card: BriefingCard) => ReactNode;
  onMonthChange: (month: string | null) => void;
}) {
  const blocked = useContext(RequestPending);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dates = feed.value?.items.map((day) => day.date).join('|');
  useEffect(() => {
    const timeline = timelineRef.current;
    const main = timeline?.closest('main');
    if (!timeline || !main) {
      onMonthChange(new Date().toLocaleDateString('en-CA').slice(0, 7));
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const days = Array.from(timeline.querySelectorAll<HTMLElement>('[data-timeline-date]'));
      const edge = main.getBoundingClientRect().top + 24;
      // The day intersecting the reading edge owns the month, including its reserved card area.
      const current = days.find((day) => day.getBoundingClientRect().bottom > edge) ?? days.at(-1);
      onMonthChange(current?.dataset.timelineDate?.slice(0, 7) ?? null);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(timeline);
    observer.observe(main);
    main.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      main.removeEventListener('scroll', schedule);
    };
  }, [dates, !!feed.error, onMonthChange]);
  if (feed.error) return <Failure error={feed.error} retry={() => void feed.reload()} />;
  if (!feed.value) return <Loading />;
  if (!feed.value.items.length)
    return (
      <Empty
        icon={Newspaper}
        title="暂时没有生成的画报"
        text="有画报的日期会显示在这里。可以前往推荐栏生成更多。"
      />
    );
  return (
    <div
      ref={timelineRef}
      className="live-date-timeline"
      aria-label="画报日期时间线"
      aria-busy={feed.loading}
    >
      {feed.value.items.map((day) => (
        <TimelineDay
          key={day.date}
          tenant={tenant}
          zone={zone}
          day={day}
          asOf={feed.value!.asOf}
          revision={revision}
          renderCard={renderCard}
        />
      ))}
      <BriefingFeedTail feed={feed} blocked={blocked} />
    </div>
  );
}
function TimelineDay({
  tenant,
  zone,
  day,
  asOf,
  revision,
  renderCard,
}: {
  tenant: string;
  zone: string;
  day: BriefingDay;
  asOf: string;
  revision: number;
  renderCard: (card: BriefingCard) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const blocked = useContext(RequestPending);
  const id = useId();
  const [active, setActive] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setActive(true);
          observer.disconnect();
        }
      },
      { root: element.closest('main'), rootMargin: '250px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const remainder = useInfiniteBriefing<BriefingPage>(
    (offset, _previous, signal) =>
      active && day.total > day.items.length
        ? briefingClient.timelineDay(tenant, day.date, zone, offset + day.items.length, asOf, signal)
        : Promise.resolve(null),
    [tenant, day.date, zone, asOf, revision, active, day.total, day.items.map(identity).join('|')],
    identity,
  );
  const selected = new Set(day.items.map(identity));
  const cards = [
    ...day.items,
    ...(remainder.value?.items.filter((card) => !selected.has(identity(card))) || []),
  ];
  const date = new Date(day.date + 'T12:00:00');
  const today = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const toggle = () => {
    if (expanded) {
      const main = ref.current?.closest('main');
      if (main && ref.current) {
        const distance = ref.current.getBoundingClientRect().top - main.getBoundingClientRect().top;
        // Collapsing a long day keeps its first cards in view instead of jumping to page top.
        if (distance < 0)
          main.scrollTo({ top: Math.max(0, main.scrollTop + distance - 16), behavior: 'instant' });
      }
    }
    setActive(true);
    setExpanded((value) => !value);
  };
  return (
    <section ref={ref} className="timeline-day" data-timeline-date={day.date} aria-label={day.date + '画报'}>
      <div className="timeline-date">
        <span className="timeline-dot" aria-hidden="true" />
        <time dateTime={day.date}>
          <strong>
            {Number(day.date.slice(5, 7))}.{Number(day.date.slice(8))}
          </strong>
          <span>{day.date === today ? '今天' : date.toLocaleDateString('zh-CN', { weekday: 'long' })}</span>
        </time>
      </div>
      <div className="timeline-day-content">
        <header className="timeline-day-heading">
          <span>共 {day.total} 张</span>
          {expanded && (
            <button
              className="timeline-expand"
              type="button"
              aria-expanded={true}
              aria-controls={id}
              disabled={blocked}
              onClick={toggle}
            >
              收起当天卡片
              <ChevronDown size={15} aria-hidden="true" />
            </button>
          )}
        </header>
        <div id={id} className="timeline-card-scroll" tabIndex={0} aria-label={day.date + '画报卡片区域'}>
          <MagazineGrid
            sizing="workspace"
            minimumColumns={2}
            minimumRows={2}
            preserveUnit
            preserveSpans
            preview={
              expanded
                ? undefined
                : {
                    rows: 2,
                    total: day.total,
                    label: `展开${day.date}全部 ${day.total} 张画报`,
                    controls: id,
                    disabled: blocked,
                    expand: toggle,
                  }
            }
            items={cards.map((card) => ({
              id: identity(card),
              title: card.briefing?.content.title ?? card.title,
              summary: card.briefing?.content.summary ?? card.excerpt,
              chart: !!card.briefing?.content.chart,
              wide: card.preference.size === 'WIDE',
              render: renderCard(card),
            }))}
          />
        </div>
        {remainder.error ? (
          <div className="timeline-day-tail">
            <Failure error={remainder.error} retry={() => void remainder.reload()} />
          </div>
        ) : expanded ? (
          <div className="timeline-day-tail">
            <BriefingFeedTail feed={remainder} blocked={blocked} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
