import { useEffect, useRef, useState, type ComponentProps } from 'react';

type Point = { x: number; y: number };
type ShortcutProps = Pick<ComponentProps<'button'>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onClick' | 'style'>;

function keepInViewport(point: Point): Point {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  return {
    x: Math.max(left + 8, Math.min(point.x, left + (viewport?.width ?? window.innerWidth) - 52)),
    y: Math.max(top + 8, Math.min(point.y, top + (viewport?.height ?? window.innerHeight) - 52)),
  };
}

export function useDraggableShortcut(positionKey: string, onOpen: () => void): ShortcutProps {
  const [position, setPosition] = useState<Point | null>(null);
  const drag = useRef<{ pointerId: number; start: Point; origin: Point; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(positionKey) || 'null');
      setPosition(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? keepInViewport(saved) : null);
    } catch {
      setPosition(null);
    }
  }, [positionKey]);

  useEffect(() => {
    const resize = () => setPosition(current => current && keepInViewport(current));
    const viewport = window.visualViewport;
    window.addEventListener('resize', resize);
    viewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      viewport?.removeEventListener('resize', resize);
    };
  }, []);

  return {
    onPointerDown(event) {
      if (event.button !== 0 || drag.current) return;
      const rect = event.currentTarget.getBoundingClientRect();
      suppressClick.current = false;
      drag.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        origin: { x: rect.left, y: rect.top },
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event) {
      const gesture = drag.current;
      if (gesture?.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.start.x;
      const dy = event.clientY - gesture.start.y;
      if (Math.hypot(dx, dy) > 6) gesture.moved = true;
      if (gesture.moved) setPosition(keepInViewport({ x: gesture.origin.x + dx, y: gesture.origin.y + dy }));
    },
    onPointerUp(event) {
      const gesture = drag.current;
      if (gesture?.pointerId !== event.pointerId) return;
      drag.current = null;
      if (!gesture.moved) return;
      suppressClick.current = true;
      const next = keepInViewport({
        x: gesture.origin.x + event.clientX - gesture.start.x,
        y: gesture.origin.y + event.clientY - gesture.start.y,
      });
      setPosition(next);
      try { localStorage.setItem(positionKey, JSON.stringify(next)); } catch { /* Optional preference. */ }
    },
    onPointerCancel(event) {
      if (drag.current?.pointerId === event.pointerId) {
        suppressClick.current = drag.current.moved;
        drag.current = null;
      }
    },
    onLostPointerCapture(event) {
      if (drag.current?.pointerId === event.pointerId) {
        suppressClick.current = drag.current.moved;
        drag.current = null;
      }
    },
    onClick(event) {
      if (suppressClick.current && event.detail !== 0) {
        suppressClick.current = false;
        return;
      }
      onOpen();
    },
    style: position
      ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto', touchAction: 'none' }
      : { touchAction: 'none' },
  };
}
