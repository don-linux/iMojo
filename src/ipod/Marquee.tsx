import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export function Marquee({ text, resetKey }: { text: string; resetKey?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  const [copyWidth, setCopyWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const copy = copyRef.current;
    if (!container || !copy) return;

    const measure = () => {
      setContainerWidth(container.clientWidth);
      setCopyWidth(copy.scrollWidth);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(copy);
    void document.fonts?.ready.then(measure);

    return () => observer.disconnect();
  }, [text]);

  const scrolling = copyWidth > containerWidth + 1;

  return (
    <div ref={containerRef} className={scrolling ? "marquee scrolling" : "marquee"} dir="auto">
      <div
        key={`${resetKey ?? ""}:${text}`}
        className="marquee-track"
        style={{ "--marquee-copy-width": copyWidth } as CSSProperties}
      >
        <span ref={copyRef} className="marquee-copy">
          {text}
        </span>
        {scrolling ? (
          <span className="marquee-copy" aria-hidden="true">
            {text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
