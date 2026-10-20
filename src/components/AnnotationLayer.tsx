import { useState, useRef, useEffect } from "react";
import { MessageSquare, Trash2, X } from "lucide-react";
import {
  usePdfStore,
  type HighlightAnnotation,
  type NoteAnnotation,
  type DrawAnnotation,
} from "../store/usePdfStore";

interface AnnotationLayerProps {
  pageNum: number;
  pageWidth: number;
  pageHeight: number;
}

/**
 * Interactive SVG/HTML overlay layer for viewing, creating, and editing annotations
 * (highlights, freehand drawing, and sticky note comments) on a single PDF page.
 */
export default function AnnotationLayer({
  pageNum,
  pageWidth,
  pageHeight,
}: AnnotationLayerProps) {
  const {
    tabs,
    activeTabId,
    activeTool,
    activeColor,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
  } = usePdfStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter annotations for this specific page
  const pageAnnotations = (activeTab?.annotations || []).filter(
    (ann) => ann.page === pageNum
  );

  // Highlighting in-progress drag state
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [highlightStart, setHighlightStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [highlightCurrent, setHighlightCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Drawing in-progress state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[]>([]);

  // Active selected annotation for editing or inspection
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  // Reset in-progress interactions when active tool changes
  useEffect(() => {
    setIsHighlighting(false);
    setHighlightStart(null);
    setHighlightCurrent(null);
    setIsDrawing(false);
    setDrawPoints([]);
  }, [activeTool]);

  /**
   * Translates mouse event coordinates to normalized [0, 1] relative coordinates.
   */
  const getNormalizedCoordinates = (e: React.MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) / pageWidth;
    const rawY = (e.clientY - rect.top) / pageHeight;
    return {
      x: Math.max(0, Math.min(1, rawX)),
      y: Math.max(0, Math.min(1, rawY)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!activeTab) return;

    // Do nothing for selection mode (clicks pass through to elements or text layer)
    if (activeTool === "select") {
      // If clicking directly on empty area, deselect any currently selected annotation
      if (e.target === containerRef.current || (e.target as HTMLElement).tagName === "svg") {
        setSelectedAnnotationId(null);
      }
      return;
    }

    const { x, y } = getNormalizedCoordinates(e);

    if (activeTool === "highlight") {
      setIsHighlighting(true);
      setHighlightStart({ x, y });
      setHighlightCurrent({ x, y });
    } else if (activeTool === "draw") {
      setIsDrawing(true);
      setDrawPoints([{ x, y }]);
    } else if (activeTool === "note") {
      // Create a new sticky note at the clicked position
      const noteId = `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newNote: NoteAnnotation = {
        id: noteId,
        page: pageNum,
        type: "note",
        color: activeColor,
        x: Math.max(0.02, Math.min(0.95, x)),
        y: Math.max(0.02, Math.min(0.95, y)),
        text: "",
      };

      addAnnotation(activeTab.id, newNote);
      setSelectedAnnotationId(noteId);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!activeTab) return;

    if (activeTool === "highlight" && isHighlighting) {
      const { x, y } = getNormalizedCoordinates(e);
      setHighlightCurrent({ x, y });
    } else if (activeTool === "draw" && isDrawing) {
      const { x, y } = getNormalizedCoordinates(e);
      setDrawPoints((prev) => [...prev, { x, y }]);
    }
  };

  const finishInteraction = () => {
    if (!activeTab) return;

    if (activeTool === "highlight" && isHighlighting && highlightStart && highlightCurrent) {
      const minX = Math.min(highlightStart.x, highlightCurrent.x);
      const minY = Math.min(highlightStart.y, highlightCurrent.y);
      const width = Math.abs(highlightCurrent.x - highlightStart.x);
      const height = Math.abs(highlightCurrent.y - highlightStart.y);

      // Only record highlights with noticeable dimensions (> 6px)
      if (width * pageWidth > 6 && height * pageHeight > 6) {
        const highlightId = `hl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newHighlight: HighlightAnnotation = {
          id: highlightId,
          page: pageNum,
          type: "highlight",
          color: activeColor,
          x: minX,
          y: minY,
          width,
          height,
        };
        addAnnotation(activeTab.id, newHighlight);
      }

      setIsHighlighting(false);
      setHighlightStart(null);
      setHighlightCurrent(null);
    } else if (activeTool === "draw" && isDrawing) {
      if (drawPoints.length > 1) {
        const drawId = `draw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newDrawing: DrawAnnotation = {
          id: drawId,
          page: pageNum,
          type: "draw",
          color: activeColor,
          strokeWidth: 3,
          points: drawPoints,
        };
        addAnnotation(activeTab.id, newDrawing);
      }

      setIsDrawing(false);
      setDrawPoints([]);
    }
  };

  const handleMouseUp = () => {
    finishInteraction();
  };

  const handleMouseLeave = () => {
    finishInteraction();
  };

  // Calculate live highlight box rectangle in screen pixels
  let liveHighlightRect: { x: number; y: number; width: number; height: number } | null =
    null;
  if (isHighlighting && highlightStart && highlightCurrent) {
    const minX = Math.min(highlightStart.x, highlightCurrent.x) * pageWidth;
    const minY = Math.min(highlightStart.y, highlightCurrent.y) * pageHeight;
    const width = Math.abs(highlightCurrent.x - highlightStart.x) * pageWidth;
    const height = Math.abs(highlightCurrent.y - highlightStart.y) * pageHeight;
    liveHighlightRect = { x: minX, y: minY, width, height };
  }

  // Determine cursor based on active tool
  let cursorClass = "cursor-default";
  if (activeTool === "highlight" || activeTool === "draw") {
    cursorClass = "cursor-crosshair";
  } else if (activeTool === "note") {
    cursorClass = "cursor-copy";
  }

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 select-none overflow-visible ${cursorClass} ${
        activeTool === "select" ? "pointer-events-none" : "pointer-events-auto"
      }`}
      style={{ width: `${pageWidth}px`, height: `${pageHeight}px` }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* SVG Container for highlights, paths, and preview shapes */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
        width={pageWidth}
        height={pageHeight}
      >
        {/* Render Highlights */}
        {pageAnnotations
          .filter((ann): ann is HighlightAnnotation => ann.type === "highlight")
          .map((hl) => {
            const isSelected = selectedAnnotationId === hl.id;
            return (
              <rect
                key={hl.id}
                x={hl.x * pageWidth}
                y={hl.y * pageHeight}
                width={hl.width * pageWidth}
                height={hl.height * pageHeight}
                fill={hl.color}
                fillOpacity={0.35}
                stroke={isSelected ? "#3b82f6" : "transparent"}
                strokeWidth={isSelected ? 1.5 : 0}
                className="pointer-events-auto transition-opacity hover:opacity-80 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedAnnotationId(isSelected ? null : hl.id);
                }}
              />
            );
          })}

        {/* Render Freehand Drawings */}
        {pageAnnotations
          .filter((ann): ann is DrawAnnotation => ann.type === "draw")
          .map((draw) => {
            if (!draw.points || draw.points.length < 2) return null;
            const pointsStr = draw.points
              .map((p) => `${p.x * pageWidth},${p.y * pageHeight}`)
              .join(" ");
            const isSelected = selectedAnnotationId === draw.id;

            return (
              <polyline
                key={draw.id}
                points={pointsStr}
                fill="none"
                stroke={draw.color}
                strokeWidth={draw.strokeWidth || 3}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.85}
                className="pointer-events-auto transition-opacity hover:opacity-100 cursor-pointer"
                style={{
                  filter: isSelected
                    ? "drop-shadow(0 0 4px rgba(59, 130, 246, 0.8))"
                    : undefined,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedAnnotationId(isSelected ? null : draw.id);
                }}
              />
            );
          })}

        {/* Live In-Progress Highlight Box */}
        {liveHighlightRect && (
          <rect
            x={liveHighlightRect.x}
            y={liveHighlightRect.y}
            width={liveHighlightRect.width}
            height={liveHighlightRect.height}
            fill={activeColor}
            fillOpacity={0.35}
            stroke={activeColor}
            strokeWidth={1}
            strokeDasharray="4 2"
          />
        )}

        {/* Live In-Progress Freehand Drawing Path */}
        {isDrawing && drawPoints.length > 1 && (
          <polyline
            points={drawPoints
              .map((p) => `${p.x * pageWidth},${p.y * pageHeight}`)
              .join(" ")}
            fill="none"
            stroke={activeColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        )}
      </svg>

      {/* Floating Action Menu for Selected Highlight or Drawing */}
      {selectedAnnotationId && activeTab && (
        (() => {
          const selectedAnn = pageAnnotations.find(
            (ann) => ann.id === selectedAnnotationId && ann.type !== "note"
          );
          if (!selectedAnn) return null;

          let menuX = 0;
          let menuY = 0;

          if (selectedAnn.type === "highlight") {
            menuX = (selectedAnn.x + selectedAnn.width) * pageWidth;
            menuY = selectedAnn.y * pageHeight - 32;
          } else if (selectedAnn.type === "draw" && selectedAnn.points.length > 0) {
            const mid = selectedAnn.points[Math.floor(selectedAnn.points.length / 2)];
            menuX = mid.x * pageWidth;
            menuY = mid.y * pageHeight - 32;
          }

          return (
            <div
              className="absolute pointer-events-auto z-40 flex items-center gap-1 bg-neutral-900 border border-neutral-700/80 rounded-md px-2 py-1 shadow-xl text-xs -translate-x-1/2"
              style={{
                left: `${Math.max(40, Math.min(pageWidth - 40, menuX))}px`,
                top: `${Math.max(10, menuY)}px`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-neutral-400 font-medium capitalize text-[11px]">
                {selectedAnn.type}
              </span>
              <div className="h-3 w-[1px] bg-neutral-700 mx-0.5" />
              <button
                type="button"
                onClick={() => {
                  deleteAnnotation(activeTab.id, selectedAnn.id);
                  setSelectedAnnotationId(null);
                }}
                className="flex items-center gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                title="Delete annotation"
              >
                <Trash2 className="w-3 h-3" />
                <span className="text-[11px]">Delete</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedAnnotationId(null)}
                className="text-neutral-400 hover:text-neutral-200 p-0.5 rounded cursor-pointer"
                title="Close"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })()
      )}

      {/* Render Sticky Notes */}
      {pageAnnotations
        .filter((ann): ann is NoteAnnotation => ann.type === "note")
        .map((note) => {
          const isSelected = selectedAnnotationId === note.id;
          const noteLeft = note.x * pageWidth;
          const noteTop = note.y * pageHeight;
          const popoverToLeft = note.x > 0.65;

          return (
            <div
              key={note.id}
              className="absolute pointer-events-auto z-30"
              style={{
                left: `${noteLeft}px`,
                top: `${noteTop}px`,
                transform: "translate(-50%, -50%)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Note Pin Icon Button */}
              <button
                type="button"
                onClick={() => {
                  setSelectedAnnotationId(isSelected ? null : note.id);
                }}
                className="p-1.5 rounded-full shadow-lg border border-black/30 hover:scale-115 active:scale-95 transition-all duration-150 flex items-center justify-center cursor-pointer"
                style={{ backgroundColor: note.color }}
                title={note.text || "Sticky Note"}
              >
                <MessageSquare className="w-3.5 h-3.5 text-neutral-900 fill-neutral-900/20" />
              </button>

              {/* Note Popover / Comment Card */}
              {isSelected && (
                <div
                  className={`absolute z-50 w-72 rounded-xl bg-neutral-900/95 border border-neutral-700/80 p-3 shadow-2xl backdrop-blur-md text-neutral-100 ${
                    popoverToLeft ? "right-2 top-8" : "left-2 top-8"
                  }`}
                  style={{ minWidth: "260px" }}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-neutral-800 mb-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: note.color }}
                      />
                      <span className="text-xs font-semibold text-neutral-200">
                        Sticky Note
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (activeTab) {
                            deleteAnnotation(activeTab.id, note.id);
                          }
                          setSelectedAnnotationId(null);
                        }}
                        className="p-1 text-neutral-400 hover:text-red-400 hover:bg-neutral-800 rounded transition-colors cursor-pointer"
                        title="Delete Note"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedAnnotationId(null)}
                        className="p-1 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors cursor-pointer"
                        title="Close"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <textarea
                    autoFocus
                    value={note.text}
                    onChange={(e) => {
                      if (activeTab) {
                        updateAnnotation(activeTab.id, note.id, {
                          text: e.target.value,
                        });
                      }
                    }}
                    placeholder="Write a comment or note..."
                    rows={3}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-amber-400/80 resize-none"
                  />
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
