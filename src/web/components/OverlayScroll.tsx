import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from "react";

interface ScrollMetrics {
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

const HIDE_DELAY_MS = 700;

function readMetrics(element: HTMLElement): ScrollMetrics {
  return {
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
  };
}

function thumbGeometry(viewport: number, content: number, offset: number, inset: number) {
  const track = Math.max(viewport - inset, 0);
  const overflow = content - viewport;
  if (track <= 0 || overflow <= 1) return null;
  const size = Math.max(36, (track * viewport) / content);
  const travel = Math.max(track - size, 0);
  const position = (offset / overflow) * travel;
  return { size, position };
}

export function OverlayScroll({
  className,
  testId,
  label,
  children,
}: {
  className?: string;
  testId?: string;
  label?: string;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef(0);
  const [metrics, setMetrics] = useState<ScrollMetrics | null>(null);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const update = () => setMetrics(readMetrics(element));
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const onScroll = () => {
    const element = bodyRef.current;
    if (!element) return;
    setMetrics(readMetrics(element));
    setScrolling(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setScrolling(false), HIDE_DELAY_MS);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const element = bodyRef.current;
    if (!element) return;
    if (element.scrollWidth - element.clientWidth <= 1) return;

    const mostlyHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (!mostlyHorizontal && !event.shiftKey) return;

    const delta = event.deltaX + event.deltaY;
    if (delta === 0) return;
    const previous = element.scrollLeft;
    element.scrollLeft += delta;
    if (element.scrollLeft !== previous) {
      event.preventDefault();
      onScroll();
    }
  };

  const horizontal = metrics
    ? thumbGeometry(metrics.clientWidth, metrics.scrollWidth, metrics.scrollLeft, 16)
    : null;
  const vertical = metrics
    ? thumbGeometry(metrics.clientHeight, metrics.scrollHeight, metrics.scrollTop, 16)
    : null;

  return (
    <div className={`overlay-scroll${scrolling ? " is-scrolling" : ""}${className ? ` ${className}` : ""}`} data-testid={testId}>
      <div
        ref={bodyRef}
        className="overlay-scroll-body"
        aria-label={label}
        onScroll={onScroll}
        onWheel={onWheel}
      >
        {children}
      </div>
      {horizontal && (
        <div className="overlay-scrollbar overlay-scrollbar-x" aria-hidden="true">
          <div
            className="overlay-scrollbar-thumb"
            style={{ width: horizontal.size, transform: `translateX(${horizontal.position}px)` }}
          />
        </div>
      )}
      {vertical && (
        <div className="overlay-scrollbar overlay-scrollbar-y" aria-hidden="true">
          <div
            className="overlay-scrollbar-thumb"
            style={{ height: vertical.size, transform: `translateY(${vertical.position}px)` }}
          />
        </div>
      )}
    </div>
  );
}
