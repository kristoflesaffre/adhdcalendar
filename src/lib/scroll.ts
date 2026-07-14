/**
 * Eased scroll that brings `el`'s bottom into view above the floating tab
 * bar. Only scrolls down (content below the fold); scrollIntoView is
 * unreliable on nested scrollers, and a manual rAF tween gives us a real
 * easing curve anyway.
 */
export function easeScrollIntoView(
  el: HTMLElement,
  margin = 110,
  duration = 450,
  /** height `el` is still about to gain (an expanding panel measured before
   *  its transition finishes) — lets the scroll run DURING the expansion */
  extraBottom = 0,
): void {
  let p: HTMLElement | null = el.parentElement;
  while (p && p.scrollHeight <= p.clientHeight + 1) p = p.parentElement;
  const scroller = p ?? (document.scrollingElement as HTMLElement);
  const elBottom =
    el.getBoundingClientRect().bottom -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop +
    extraBottom;
  const target = Math.min(
    // the scroller also grows by extraBottom once the panel finishes
    scroller.scrollHeight + extraBottom - scroller.clientHeight,
    Math.max(0, elBottom - scroller.clientHeight + margin),
  );
  const from = scroller.scrollTop;
  if (target <= from + 2) return;
  const t0 = performance.now();
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    scroller.scrollTop = from + (target - from) * easeOutCubic(t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
