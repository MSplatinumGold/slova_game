import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { soundEngine } from '../utils/sound';

interface LetterWheelProps {
  letters: string[];
  selectedIndices: number[];
  onChangeSelection: (indices: number[]) => void;
  onSubmitSelection: (indices: number[]) => void;
  disabled?: boolean;
}

interface NodePos {
  index: number;
  letter: string;
  x: number;
  y: number;
}

export function LetterWheel({
  letters,
  selectedIndices,
  onChangeSelection,
  onSubmitSelection,
  disabled = false,
}: LetterWheelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [wheelPx, setWheelPx] = useState(236);
  const [isDragging, setIsDragging] = useState(false);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);

  // Keep refs synced for pointermove performance without stale closures
  const selectedRef = useRef<number[]>(selectedIndices);
  selectedRef.current = selectedIndices;
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const dim = Math.floor(Math.min(rect.width, rect.height));
      if (dim > 120) {
        setWheelPx(Math.max(186, Math.min(268, dim)));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodeRadius = Math.max(22, Math.min(28, Math.floor(wheelPx * 0.112)));
  const orbitRadius = wheelPx / 2 - nodeRadius - 10;
  const center = wheelPx / 2;

  const nodes: NodePos[] = useMemo(() => {
    const count = letters.length;
    return letters.map((letter, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      return {
        index,
        letter,
        x: center + Math.cos(angle) * orbitRadius,
        y: center + Math.sin(angle) * orbitRadius,
      };
    });
  }, [letters, center, orbitRadius]);

  const hitRadius = nodeRadius + 8;

  const getLocalCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = containerRef.current;
      if (!el) return null;
      const wheelEl = el.querySelector('[data-wheel-surface="true"]');
      if (!wheelEl) return null;
      const rect = wheelEl.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    },
    []
  );

  const findHitNode = useCallback(
    (x: number, y: number): NodePos | null => {
      let best: NodePos | null = null;
      let bestDist = Infinity;
      for (const n of nodes) {
        const dx = x - n.x;
        const dy = y - n.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= hitRadius && dist < bestDist) {
          best = n;
          bestDist = dist;
        }
      }
      return best;
    },
    [nodes, hitRadius]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const coords = getLocalCoords(e.clientX, e.clientY);
    if (!coords) return;

    const hit = findHitNode(coords.x, coords.y);
    if (!hit) return;

    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture unavailable
    }

    draggingRef.current = true;
    setIsDragging(true);
    setPointerPos(coords);
    selectedRef.current = [hit.index];
    onChangeSelection([hit.index]);
    soundEngine.playLetterSelect(0);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || disabled) return;
    const coords = getLocalCoords(e.clientX, e.clientY);
    if (!coords) return;

    setPointerPos(coords);
    const hit = findHitNode(coords.x, coords.y);
    if (!hit) return;

    const cur = selectedRef.current;
    const existingPos = cur.indexOf(hit.index);

    if (existingPos === -1) {
      const next = [...cur, hit.index];
      selectedRef.current = next;
      onChangeSelection(next);
      soundEngine.playLetterSelect(next.length - 1);
    } else if (cur.length >= 2 && existingPos === cur.length - 2) {
      // Backtrack: dragging back onto the second-to-last letter cancels the last one
      const next = cur.slice(0, -1);
      selectedRef.current = next;
      onChangeSelection(next);
      soundEngine.playLetterSelect(Math.max(0, next.length - 1));
    }
  };

  const finishDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    setPointerPos(null);
    const finalIndices = selectedRef.current;
    if (finalIndices.length > 0) {
      onSubmitSelection(finalIndices);
    }
  };

  const linePoints = useMemo(() => {
    const pts = selectedIndices
      .map((idx) => nodes[idx])
      .filter(Boolean)
      .map((n) => `${n.x},${n.y}`);
    if (isDragging && pointerPos && pts.length > 0) {
      pts.push(`${pointerPos.x},${pointerPos.y}`);
    }
    return pts.join(' ');
  }, [selectedIndices, nodes, isDragging, pointerPos]);

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center select-none"
    >
      <div
        data-wheel-surface="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        style={{ width: wheelPx, height: wheelPx, touchAction: 'none' }}
        className="relative rounded-full border border-white/20 bg-slate-900/55 shadow-2xl backdrop-blur-md"
      >
        {/* SVG Connecting Lines */}
        <svg
          width={wheelPx}
          height={wheelPx}
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          {selectedIndices.length > 0 && (
            <polyline
              points={linePoints}
              fill="none"
              stroke="rgba(251, 191, 36, 0.85)"
              strokeWidth={8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        {/* Letter Nodes */}
        {nodes.map((n) => {
          const isSelected = selectedIndices.includes(n.index);
          const fontSize = Math.max(20, Math.floor(nodeRadius * 0.88));
          return (
            <div
              key={`${n.index}-${n.letter}`}
              style={{
                width: nodeRadius * 2,
                height: nodeRadius * 2,
                left: n.x - nodeRadius,
                top: n.y - nodeRadius,
                fontSize,
              }}
              className={`pointer-events-none absolute flex items-center justify-center rounded-full font-display font-bold uppercase transition-transform duration-100 ${
                isSelected
                  ? 'scale-110 bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/35'
                  : 'bg-[#faf8f3]/95 text-[#172230] shadow-md'
              }`}
            >
              {n.letter}
            </div>
          );
        })}
      </div>
    </div>
  );
}
