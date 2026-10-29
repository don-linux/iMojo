import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export function Marquee({ text, resetKey }: { text: string; resetKey?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  const [copyWidth, setCopyWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const copyWidthPx = Math.round(copyWidth);

  useLayoutEffect(() => {
    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      const container = containerRef.current;
      const copy = copyRef.current;
      if (!container || !copy || !container.isConnected || !copy.isConnected) return;
      // scrollWidth stays the full text width when reduced motion clamps the copy.
      // offsetWidth would match the box and drop the scrolling class.
      const nextCopy = Math.round(copy.scrollWidth);
      const nextContainer = container.clientWidth;
      setCopyWidth((current) => (current === nextCopy ? current : nextCopy));
      setContainerWidth((current) => (current === nextContainer ? current : nextContainer));
    };

    measure();
    const observer = new ResizeObserver(() => {
      measure();
    });
    const container = containerRef.current;
    const copy = copyRef.current;
    if (container) observer.observe(container);
    if (copy) observer.observe(copy);

    const fonts = document.fonts;
    const onFonts = () => {
      measure();
    };
    fonts?.addEventListener("loadingdone", onFonts);
    void fonts?.ready.then(() => {
      if (!cancelled) measure();
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      fonts?.removeEventListener("loadingdone", onFonts);
    };
  }, [text, copyWidthPx]);

  const scrolling = copyWidth > containerWidth + 1;

  return (
    <div ref={containerRef} className={scrolling ? "marquee scrolling" : "marquee"} dir="auto">
      <div
        key={`${resetKey ?? ""}:${text}:${copyWidthPx}`}
        className="marquee-track"
        style={{ "--marquee-copy-width": copyWidthPx } as CSSProperties}
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
