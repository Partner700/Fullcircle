import { useEffect } from 'react';

const SCROLL_SELECTOR = '.overflow-y-auto:not([data-no-scroll-fade])';

export function useScrollBoundaryFades() {
  useEffect(() => {
    const tracked = new Set<HTMLElement>();
    const scrollHandlers = new Map<HTMLElement, () => void>();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          entries.forEach((entry) => update(entry.target as HTMLElement));
        });

    const update = (element: HTMLElement) => {
      const scrollable = element.scrollHeight > element.clientHeight + 2;
      element.classList.toggle('scroll-boundary-fade', scrollable);
      element.classList.toggle('scroll-fade-top', scrollable && element.scrollTop > 2);
      element.classList.toggle(
        'scroll-fade-bottom',
        scrollable && element.scrollTop + element.clientHeight < element.scrollHeight - 2,
      );
    };

    const track = (element: HTMLElement) => {
      if (tracked.has(element)) return;
      tracked.add(element);
      const handler = () => update(element);
      scrollHandlers.set(element, handler);
      element.addEventListener('scroll', handler, { passive: true });
      resizeObserver?.observe(element);
      update(element);
    };

    const scan = (root: ParentNode) => {
      if (root instanceof HTMLElement && root.matches(SCROLL_SELECTOR)) track(root);
      root.querySelectorAll<HTMLElement>(SCROLL_SELECTOR).forEach(track);
    };

    scan(document);
    const mutationObserver = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) scan(node);
      }));
      tracked.forEach(update);
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    const handleResize = () => tracked.forEach(update);
    window.addEventListener('resize', handleResize);

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      tracked.forEach((element) => {
        const handler = scrollHandlers.get(element);
        if (handler) element.removeEventListener('scroll', handler);
        element.classList.remove('scroll-boundary-fade', 'scroll-fade-top', 'scroll-fade-bottom');
      });
      window.removeEventListener('resize', handleResize);
      scrollHandlers.clear();
      tracked.clear();
    };
  }, []);
}
