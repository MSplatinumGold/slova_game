import { useEffect, useMemo, useRef, useState } from 'react';
import { Hammer } from 'lucide-react';
import type { GridCellView } from '../../shared/types';

interface CrosswordGridProps {
  rows: number;
  cols: number;
  cells: GridCellView[];
  hammerMode: boolean;
  onCancelHammer: () => void;
  onSelectHammerCell: (row: number, col: number) => void;
  gridNotice: string | null;
}

export function CrosswordGrid({
  rows,
  cols,
  cells,
  hammerMode,
  onCancelHammer,
  onSelectHammerCell,
  gridNotice,
}: CrosswordGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [boxSize, setBoxSize] = useState({ width: 320, height: 280 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBoxSize({ width: rect.width, height: rect.height });
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cellMap = useMemo(() => {
    const m = new Map<string, GridCellView>();
    for (const c of cells) {
      m.set(`${c.row},${c.col}`, c);
    }
    return m;
  }, [cells]);

  // Fit-to-container exact math with comfortable padding
  const padX = 16;
  const padY = hammerMode ? 44 : 16;
  const availW = Math.max(120, boxSize.width - padX);
  const availH = Math.max(120, boxSize.height - padY);
  const gap = Math.max(2, Math.min(5, Math.floor(Math.min(availW / cols, availH / rows) * 0.1)));

  const maxCellW = Math.floor((availW - gap * Math.max(0, cols - 1)) / Math.max(1, cols));
  const maxCellH = Math.floor((availH - gap * Math.max(0, rows - 1)) / Math.max(1, rows));
  const cellSize = Math.max(20, Math.min(54, maxCellW, maxCellH));
  const fontSize = Math.max(12, Math.floor(cellSize * 0.56));
  const radius = Math.max(5, Math.floor(cellSize * 0.2));

  const gridWidth = cols * cellSize + Math.max(0, cols - 1) * gap;
  const gridHeight = rows * cellSize + Math.max(0, rows - 1) * gap;

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden select-none"
    >
      {/* Hammer aiming instruction bar */}
      {hammerMode && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-amber-300/45 bg-slate-900/85 px-3.5 py-1.5 text-xs font-medium text-amber-100 shadow-lg backdrop-blur-md">
          <Hammer className="h-3.5 w-3.5 text-amber-300 shrink-0" />
          <span>Нажмите на закрытую клетку</span>
          <button
            type="button"
            onClick={onCancelHammer}
            className="ml-1 rounded-md bg-white/10 px-2 py-0.5 text-xs text-slate-200 hover:bg-white/20 whitespace-nowrap"
          >
            Отмена
          </button>
        </div>
      )}

      {/* Brief floating notice when someone solves a word */}
      {gridNotice && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute top-1.5 z-20 rounded-xl border border-emerald-300/35 bg-slate-900/85 px-3.5 py-1.5 text-xs font-semibold text-emerald-100 shadow-lg backdrop-blur-md"
        >
          {gridNotice}
        </div>
      )}

      {/* Centered Crossword Matrix */}
      <div
        style={{
          width: gridWidth,
          height: gridHeight,
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
          gap: `${gap}px`,
        }}
        role="grid"
        aria-label="Игровое поле кроссворда"
      >
        {Array.from({ length: rows * cols }, (_, index) => {
          const r = Math.floor(index / cols);
          const c = index % cols;
          const cell = cellMap.get(`${r},${c}`);

          if (!cell) {
            return <div key={`${r}-${c}`} aria-hidden="true" />;
          }

          const isOpen = cell.letter !== null;

          if (isOpen) {
            return (
              <div
                key={`${r}-${c}`}
                style={{
                  width: cellSize,
                  height: cellSize,
                  fontSize,
                  borderRadius: radius,
                }}
                className={`animate-tile-pop flex items-center justify-center font-display font-bold uppercase shadow-sm ${
                  cell.isHinted
                    ? 'bg-amber-50 text-amber-950 border-b-2 border-amber-300'
                    : 'bg-[#faf8f3] text-[#172230] border-b-2 border-[#d4cdc0]'
                }`}
              >
                {cell.letter}
              </div>
            );
          }

          return (
            <button
              key={`${r}-${c}`}
              type="button"
              disabled={!hammerMode}
              onClick={() => {
                if (hammerMode) {
                  onSelectHammerCell(r, c);
                }
              }}
              aria-label={
                hammerMode
                  ? `Открыть клетку строка ${r + 1}, столбец ${c + 1}`
                  : 'Закрытая буква'
              }
              style={{
                width: cellSize,
                height: cellSize,
                borderRadius: radius,
              }}
              className={`flex items-center justify-center backdrop-blur-sm transition ${
                hammerMode
                  ? 'cursor-crosshair border-2 border-amber-300 bg-amber-400/25 hover:bg-amber-400/45 active:scale-95'
                  : 'cursor-default border border-white/30 bg-[#f6f3ec]/20'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
