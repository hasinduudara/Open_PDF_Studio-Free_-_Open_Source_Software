import { useEffect, useRef, useState } from "react";
import type * as pdfjsLib from "pdfjs-dist";
import {
  LayoutGrid,
  Bookmark,
  ChevronRight,
  ChevronDown,
  Loader2,
  FileQuestion,
} from "lucide-react";
import { usePdfStore } from "../store/usePdfStore";

interface ThumbnailProps {
  pageNum: number;
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  rotation: number;
  isActive: boolean;
  onSelect: (pageNum: number) => void;
}

/**
 * Lazily renders a small canvas thumbnail for a single PDF page
 * using IntersectionObserver to maintain high performance.
 */
function ThumbnailItem({
  pageNum,
  pdfDoc,
  rotation,
  isActive,
  onSelect,
}: ThumbnailProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isRendered, setIsRendered] = useState<boolean>(false);

  // Auto-scroll the thumbnail into view if it becomes active
  useEffect(() => {
    if (isActive && containerRef.current) {
      containerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [isActive]);

  // Set up intersection observer for lazy rendering
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.unobserve(el);
          }
        });
      },
      {
        rootMargin: "200px 0px", // Preload slightly before scrolling into view
        threshold: 0.01,
      }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Render canvas once the thumbnail becomes visible or when rotation changes
  useEffect(() => {
    if (!isVisible || !pdfDoc || !canvasRef.current) return;

    let isCancelled = false;

    async function renderThumbnail() {
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (isCancelled) return;

        // Use fixed scale (~0.2) to fit thumbnail panel nicely
        const viewport = page.getViewport({ scale: 0.22, rotation });
        setDimensions({ width: viewport.width, height: viewport.height });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // Ignored
          }
        }

        const renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
        });
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        if (!isCancelled) {
          setIsRendered(true);
        }
      } catch (error: unknown) {
        const err = error as { name?: string };
        if (err?.name !== "RenderingCancelledException") {
          console.error(`Error rendering thumbnail for page ${pageNum}:`, error);
        }
      }
    }

    renderThumbnail();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // Ignored
        }
      }
    };
  }, [isVisible, pdfDoc, pageNum, rotation]);

  return (
    <div
      ref={containerRef}
      onClick={() => onSelect(pageNum)}
      className="flex flex-col items-center cursor-pointer group py-2"
    >
      <div
        className={`relative flex items-center justify-center rounded overflow-hidden shadow-md transition-all duration-150 bg-white ${
          isActive
            ? "ring-2 ring-blue-500 shadow-blue-500/20"
            : "ring-1 ring-neutral-800 hover:ring-neutral-600"
        }`}
        style={{
          width: dimensions ? `${dimensions.width}px` : "120px",
          minHeight: dimensions ? `${dimensions.height}px` : "160px",
        }}
      >
        <canvas ref={canvasRef} className="block" />
        {!isRendered && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/40">
            <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
          </div>
        )}
      </div>

      <span
        className={`mt-1.5 text-[11px] font-mono transition-colors ${
          isActive
            ? "font-semibold text-blue-400"
            : "text-neutral-400 group-hover:text-neutral-200"
        }`}
      >
        {pageNum}
      </span>
    </div>
  );
}

/**
 * Resolves a PDF destination (named or explicit array) into a 1-based page number.
 */
async function resolveDestinationPage(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  dest: unknown
): Promise<number | null> {
  if (!dest) return null;

  try {
    let explicitDest = dest;
    if (typeof dest === "string") {
      const resolved = await pdfDoc.getDestination(dest);
      if (!resolved) return null;
      explicitDest = resolved;
    }

    if (Array.isArray(explicitDest) && explicitDest.length > 0) {
      const pageRef = explicitDest[0];
      if (typeof pageRef === "object" && pageRef !== null) {
        const pageIndex = await pdfDoc.getPageIndex(pageRef);
        return pageIndex + 1;
      } else if (typeof pageRef === "number") {
        return pageRef + 1;
      }
    }
  } catch (error) {
    console.error("Failed to resolve bookmark destination:", error);
  }

  return null;
}

interface OutlineNode {
  title: string;
  dest?: unknown;
  items?: OutlineNode[];
}

interface OutlineItemProps {
  node: OutlineNode;
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  onNavigate: (pageNum: number) => void;
  depth: number;
}

/**
 * Recursively renders an outline bookmark node with collapsible sub-items.
 */
function OutlineItem({ node, pdfDoc, onNavigate, depth }: OutlineItemProps) {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const hasChildren = node.items && node.items.length > 0;

  async function handleClick() {
    if (node.dest) {
      const pageNum = await resolveDestinationPage(pdfDoc, node.dest);
      if (pageNum !== null) {
        onNavigate(pageNum);
      }
    }
  }

  return (
    <div className="text-xs select-none">
      <div
        className="flex items-center gap-1.5 rounded py-1 px-1.5 hover:bg-neutral-800/80 cursor-pointer text-neutral-300 hover:text-white transition-colors"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            className="p-0.5 rounded text-neutral-500 hover:text-neutral-300"
          >
            {isOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <span
          onClick={handleClick}
          className="truncate flex-1"
          title={node.title}
        >
          {node.title || "Untitled"}
        </span>
      </div>

      {hasChildren && isOpen && (
        <div>
          {node.items!.map((child, idx) => (
            <OutlineItem
              key={`${child.title}-${idx}`}
              node={child}
              pdfDoc={pdfDoc}
              onNavigate={onNavigate}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible left sidebar containing page thumbnails and document bookmarks/outline.
 */
export default function Sidebar() {
  const {
    tabs,
    activeTabId,
    isSidebarOpen,
    sidebarTab,
    setSidebarTab,
    setPage,
    pdfDoc,
  } = usePdfStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [outlineLoading, setOutlineLoading] = useState<boolean>(false);

  // Load PDF outline whenever pdfDoc changes
  useEffect(() => {
    if (!pdfDoc) {
      setOutline(null);
      return;
    }

    let isSubscribed = true;
    setOutlineLoading(true);

    pdfDoc
      .getOutline()
      .then((items) => {
        if (!isSubscribed) return;
        setOutline(items as OutlineNode[] | null);
        setOutlineLoading(false);
      })
      .catch((err) => {
        if (!isSubscribed) return;
        console.error("Failed to load outline:", err);
        setOutline(null);
        setOutlineLoading(false);
      });

    return () => {
      isSubscribed = false;
    };
  }, [pdfDoc]);

  if (!activeTab || !isSidebarOpen) {
    return null;
  }

  const pageNumbers = Array.from(
    { length: activeTab.numPages || 0 },
    (_, i) => i + 1
  );

  return (
    <aside className="flex w-64 flex-col border-r border-neutral-800 bg-neutral-950 select-none flex-shrink-0 h-full">
      {/* Sidebar Sub-tabs Header */}
      <div className="flex h-10 border-b border-neutral-800 bg-neutral-900/60 p-1 gap-1">
        <button
          type="button"
          onClick={() => setSidebarTab("thumbnails")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors ${
            sidebarTab === "thumbnails"
              ? "bg-neutral-800 text-neutral-100 shadow-sm"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40"
          }`}
          title="Page Thumbnails"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span>Thumbnails</span>
        </button>

        <button
          type="button"
          onClick={() => setSidebarTab("outline")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors ${
            sidebarTab === "outline"
              ? "bg-neutral-800 text-neutral-100 shadow-sm"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40"
          }`}
          title="Document Bookmarks / Outline"
        >
          <Bookmark className="h-3.5 w-3.5" />
          <span>Bookmarks</span>
        </button>
      </div>

      {/* Tab Content Panel */}
      <div className="flex-1 overflow-y-auto p-3">
        {sidebarTab === "thumbnails" && (
          <div className="space-y-2">
            {pdfDoc &&
              pageNumbers.map((pageNum) => (
                <ThumbnailItem
                  key={`thumb-${activeTab.id}-${pageNum}-${activeTab.rotation}`}
                  pageNum={pageNum}
                  pdfDoc={pdfDoc}
                  rotation={activeTab.rotation}
                  isActive={pageNum === activeTab.currentPage}
                  onSelect={(p) => setPage(activeTab.id, p)}
                />
              ))}
          </div>
        )}

        {sidebarTab === "outline" && (
          <div>
            {outlineLoading && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-neutral-400">
                <Loader2 className="h-5 w-5 animate-spin text-red-500" />
                <span className="text-xs">Loading bookmarks...</span>
              </div>
            )}

            {!outlineLoading && (!outline || outline.length === 0) && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-neutral-400">
                <FileQuestion className="h-8 w-8 text-neutral-600 mb-2" />
                <p className="text-xs font-medium text-neutral-300">
                  No bookmarks available
                </p>
                <p className="text-[11px] text-neutral-500 mt-1">
                  This PDF document does not contain an embedded table of contents.
                </p>
              </div>
            )}

            {!outlineLoading && outline && outline.length > 0 && pdfDoc && (
              <div className="space-y-0.5">
                {outline.map((node, idx) => (
                  <OutlineItem
                    key={`outline-${node.title}-${idx}`}
                    node={node}
                    pdfDoc={pdfDoc}
                    onNavigate={(p) => setPage(activeTab.id, p)}
                    depth={0}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
