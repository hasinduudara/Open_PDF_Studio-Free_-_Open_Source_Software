import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Loader2, AlertCircle } from "lucide-react";
import { usePdfStore, type PdfTab } from "../store/usePdfStore";
import SearchBar from "./SearchBar";
import AnnotationLayer from "./AnnotationLayer";

// Initialize PDF.js worker using Vite URL resolution
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PageItemProps {
  pageNum: number;
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  scale: number;
  rotation: number;
  defaultPageSize: { width: number; height: number };
}

interface TextItemData {
  str: string;
  left: number;
  top: number;
  fontSize: number;
  angle: number;
  fontName: string;
}

/**
 * Multiplies two 2D affine transform matrices (6 elements each).
 */
function multiplyTransform(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Renders an individual PDF page with canvas and selectable text overlay layer.
 * Supports search term highlighting and dark page reading mode inversion.
 */
function PdfPageItem({
  pageNum,
  pdfDoc,
  scale,
  rotation,
  defaultPageSize,
}: PageItemProps) {
  const {
    isDarkPageMode,
    searchQuery,
    searchMatches,
    currentMatchIndex,
  } = usePdfStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [textItems, setTextItems] = useState<TextItemData[]>([]);

  useEffect(() => {
    let isCancelled = false;

    async function renderPage() {
      if (!canvasRef.current || !pdfDoc) return;

      try {
        const page = await pdfDoc.getPage(pageNum);
        if (isCancelled) return;

        const viewport = page.getViewport({ scale, rotation });
        setPageSize({ width: viewport.width, height: viewport.height });

        // 1. Render Canvas
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // Ignored
          }
        }

        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        renderTaskRef.current = renderTask;

        await renderTask.promise;

        if (isCancelled) return;

        // 2. Extract Text Content for selectable layer
        const textContent = await page.getTextContent();
        if (isCancelled) return;

        const extracted: TextItemData[] = [];
        for (const rawItem of textContent.items) {
          if (!("str" in rawItem) || !rawItem.str) continue;

          const t = multiplyTransform(viewport.transform, rawItem.transform);
          const fontSize = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 12;
          const angle = Math.atan2(t[1], t[0]);

          extracted.push({
            str: rawItem.str,
            left: t[4],
            top: t[5] - fontSize,
            fontSize,
            angle,
            fontName: rawItem.fontName || "sans-serif",
          });
        }

        setTextItems(extracted);
      } catch (error: unknown) {
        const err = error as { name?: string };
        if (err?.name !== "RenderingCancelledException") {
          console.error(`Error rendering page ${pageNum}:`, error);
        }
      }
    }

    renderPage();

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
  }, [pageNum, pdfDoc, scale, rotation]);

  // Center active search match when this page finishes loading text items
  useEffect(() => {
    if (textItems.length > 0) {
      const activeEl = document.getElementById("active-search-match");
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: "instant", block: "center" });
      }
    }
  }, [textItems, currentMatchIndex]);

  const width = pageSize ? pageSize.width : defaultPageSize.width;
  const height = pageSize ? pageSize.height : defaultPageSize.height;

  // Track global match indices that land on this page
  const pageMatchGlobalIndices = searchMatches
    .filter((m) => m.page === pageNum)
    .map((m) => m.matchIndex);

  let currentOccurenceOnPage = 0;

  return (
    <div
      id={`pdf-page-${pageNum}`}
      data-page-number={pageNum}
      className={`relative mb-6 rounded shadow-2xl transition-all duration-200 ${
        isDarkPageMode ? "bg-neutral-900" : "bg-white"
      }`}
      style={{
        width: `${width}px`,
        minHeight: `${height}px`,
      }}
    >
      {/* Visual Canvas (with dark reading mode filter) */}
      <canvas
        ref={canvasRef}
        className="block rounded"
        style={{
          filter: isDarkPageMode ? "invert(0.9) hue-rotate(180deg)" : "none",
          transition: "filter 0.2s ease",
        }}
      />

      {/* Selectable and Search-Highlightable Text Layer */}
      <div
        className="pdf-text-layer absolute inset-0 overflow-hidden pointer-events-auto select-text"
        style={{
          width: `${width}px`,
          height: `${height}px`,
        }}
      >
        {textItems.map((item, idx) => {
          const trimmedQuery = searchQuery.trim();

          // Render highlighted text if search is active
          if (trimmedQuery.length > 0) {
            const lowerStr = item.str.toLowerCase();
            const lowerQuery = trimmedQuery.toLowerCase();

            if (lowerStr.includes(lowerQuery)) {
              const parts: Array<{ text: string; isMatch: boolean; globalIndex?: number }> = [];
              let lastIndex = 0;

              while (lastIndex < item.str.length) {
                const foundIndex = lowerStr.indexOf(lowerQuery, lastIndex);
                if (foundIndex === -1) {
                  parts.push({
                    text: item.str.slice(lastIndex),
                    isMatch: false,
                  });
                  break;
                }

                if (foundIndex > lastIndex) {
                  parts.push({
                    text: item.str.slice(lastIndex, foundIndex),
                    isMatch: false,
                  });
                }

                const matchGlobalIndex =
                  currentOccurenceOnPage < pageMatchGlobalIndices.length
                    ? pageMatchGlobalIndices[currentOccurenceOnPage++]
                    : undefined;

                parts.push({
                  text: item.str.slice(foundIndex, foundIndex + trimmedQuery.length),
                  isMatch: true,
                  globalIndex: matchGlobalIndex,
                });

                lastIndex = foundIndex + trimmedQuery.length;
              }

              return (
                <span
                  key={idx}
                  style={{
                    position: "absolute",
                    left: `${item.left}px`,
                    top: `${item.top}px`,
                    fontSize: `${item.fontSize}px`,
                    fontFamily: item.fontName,
                    lineHeight: 1,
                    whiteSpace: "pre",
                    color: "transparent",
                    opacity: 1,
                    transformOrigin: "left top",
                    transform: item.angle !== 0 ? `rotate(${item.angle}rad)` : undefined,
                  }}
                >
                  {parts.map((p, pIdx) => {
                    if (p.isMatch) {
                      const isActiveMatch =
                        p.globalIndex !== undefined && p.globalIndex === currentMatchIndex;

                      return (
                        <mark
                          key={pIdx}
                          id={isActiveMatch ? "active-search-match" : undefined}
                          className={`rounded-xs text-transparent ${
                            isActiveMatch
                              ? "bg-orange-500/80 ring-2 ring-orange-400 font-semibold"
                              : "bg-yellow-400/60"
                          }`}
                        >
                          {p.text}
                        </mark>
                      );
                    }
                    return (
                      <span key={pIdx} style={{ color: "transparent" }}>
                        {p.text}
                      </span>
                    );
                  })}
                </span>
              );
            }
          }

          // Default transparent selectable text run
          return (
            <span
              key={idx}
              style={{
                position: "absolute",
                left: `${item.left}px`,
                top: `${item.top}px`,
                fontSize: `${item.fontSize}px`,
                fontFamily: item.fontName,
                lineHeight: 1,
                whiteSpace: "pre",
                color: "transparent",
                opacity: 1,
                transformOrigin: "left top",
                transform: item.angle !== 0 ? `rotate(${item.angle}rad)` : undefined,
              }}
            >
              {item.str}
            </span>
          );
        })}
      </div>

      {/* Interactive Annotation Layer */}
      <AnnotationLayer
        pageNum={pageNum}
        pageWidth={width}
        pageHeight={height}
      />

      {/* Page Number Badge */}
      <div className="absolute bottom-2 right-2 rounded bg-neutral-900/60 px-1.5 py-0.5 text-[10px] font-mono text-white/70 backdrop-blur-sm pointer-events-none">
        {pageNum}
      </div>
    </div>
  );
}

/**
 * Main PDF viewer component.
 * Distinguishes programmatic jumps from user manual scrolling and embeds fixed search bar.
 */
export default function PdfViewer() {
  const {
    tabs,
    activeTabId,
    setNumPages,
    setCurrentPageFromScroll,
    clearScrollTarget,
    setPdfDoc,
    currentMatchIndex,
    searchMatches,
  } = usePdfStore();

  const activeTab: PdfTab | undefined = tabs.find((t) => t.id === activeTabId);

  const [pdfDoc, setLocalPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [defaultPageSize, setDefaultPageSize] = useState<{ width: number; height: number }>({
    width: 600,
    height: 800,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollRef = useRef<boolean>(false);

  // Load document whenever active tab changes
  useEffect(() => {
    if (!activeTab || !activeTab.data) {
      setLocalPdfDoc(null);
      setPdfDoc(null);
      return;
    }

    let isSubscribed = true;
    setLoading(true);
    setErrorMsg(null);

    const dataCopy = new Uint8Array(activeTab.data);
    const loadingTask = pdfjsLib.getDocument({
      data: dataCopy,
    });

    loadingTask.promise
      .then(async (loadedDoc) => {
        if (!isSubscribed) return;

        try {
          const firstPage = await loadedDoc.getPage(1);
          const initialVp = firstPage.getViewport({
            scale: activeTab.scale,
            rotation: activeTab.rotation,
          });
          setDefaultPageSize({
            width: Math.floor(initialVp.width),
            height: Math.floor(initialVp.height),
          });
        } catch (e) {
          console.warn("Failed to pre-compute initial page dimensions:", e);
        }

        setLocalPdfDoc(loadedDoc);
        setPdfDoc(loadedDoc);
        setNumPages(activeTab.id, loadedDoc.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (!isSubscribed) return;
        console.error("Failed to load PDF document:", err);
        setErrorMsg("Failed to parse and load PDF document.");
        setLocalPdfDoc(null);
        setPdfDoc(null);
        setLoading(false);
      });

    return () => {
      isSubscribed = false;
      loadingTask.destroy();
    };
  }, [activeTab?.id, activeTab?.data, setNumPages, setPdfDoc]);

  // Recalculate baseline page dimensions when scale or rotation changes
  useEffect(() => {
    if (!pdfDoc || !activeTab) return;

    pdfDoc
      .getPage(1)
      .then((firstPage) => {
        const vp = firstPage.getViewport({
          scale: activeTab.scale,
          rotation: activeTab.rotation,
        });
        setDefaultPageSize({
          width: Math.floor(vp.width),
          height: Math.floor(vp.height),
        });
      })
      .catch((e) => {
        console.warn("Failed to update page baseline dimensions:", e);
      });
  }, [pdfDoc, activeTab?.scale, activeTab?.rotation]);

  // Handle Programmatic Scroll Jumps (ONLY triggered when scrollTargetPage is set)
  const scrollTargetPage = activeTab?.scrollTargetPage;
  useEffect(() => {
    if (!scrollTargetPage || !containerRef.current) return;

    const targetEl = document.getElementById(`pdf-page-${scrollTargetPage}`);
    const container = containerRef.current;

    if (targetEl && container) {
      isProgrammaticScrollRef.current = true;
      const targetTop = targetEl.offsetTop - container.offsetTop - 16;

      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "instant",
      });

      clearScrollTarget();

      requestAnimationFrame(() => {
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 80);
      });
    }
  }, [scrollTargetPage, clearScrollTarget]);

  // Scroll active search match element into center of view
  useEffect(() => {
    if (searchMatches.length === 0) return;

    const timer = setTimeout(() => {
      const activeMatchEl = document.getElementById("active-search-match");
      if (activeMatchEl) {
        isProgrammaticScrollRef.current = true;
        activeMatchEl.scrollIntoView({ behavior: "instant", block: "center" });

        requestAnimationFrame(() => {
          setTimeout(() => {
            isProgrammaticScrollRef.current = false;
          }, 80);
        });
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [currentMatchIndex, searchMatches]);

  // Track page visibility with IntersectionObserver during manual scrolling
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeTab || !pdfDoc) return;

    const pageElements = container.querySelectorAll("[data-page-number]");
    if (pageElements.length === 0) return;

    const visibilityMap = new Map<number, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScrollRef.current) return;

        entries.forEach((entry) => {
          const pageNum = parseInt(entry.target.getAttribute("data-page-number") || "1", 10);
          if (entry.isIntersecting) {
            visibilityMap.set(pageNum, entry.intersectionRatio);
          } else {
            visibilityMap.delete(pageNum);
          }
        });

        let bestPage = activeTab.currentPage;
        let highestRatio = 0;

        visibilityMap.forEach((ratio, pageNum) => {
          if (ratio > highestRatio) {
            highestRatio = ratio;
            bestPage = pageNum;
          }
        });

        if (bestPage !== activeTab.currentPage && highestRatio > 0.15) {
          setCurrentPageFromScroll(bestPage);
        }
      },
      {
        root: container,
        threshold: [0.1, 0.3, 0.6, 0.9],
      }
    );

    pageElements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
    };
  }, [pdfDoc, activeTab?.id, activeTab?.scale, activeTab?.rotation, setCurrentPageFromScroll]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-neutral-900 text-neutral-400">
        <Loader2 className="h-8 w-8 animate-spin text-red-500" />
        <span className="text-sm font-medium">Loading document...</span>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-neutral-900 p-6 text-center text-red-400">
        <AlertCircle className="h-10 w-10 text-red-500" />
        <h3 className="text-base font-semibold text-neutral-200">Unable to load document</h3>
        <p className="max-w-md text-xs text-neutral-400">{errorMsg}</p>
      </div>
    );
  }

  if (!pdfDoc || !activeTab) {
    return null;
  }

  const pageNumbers = Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden h-full">
      {/* Floating In-Document Search Bar (pinned to viewer viewport, never scrolls away) */}
      <SearchBar />

      {/* Scrollable Document Pages Container */}
      <div
        id="pdf-viewer-container"
        ref={containerRef}
        className="flex flex-1 justify-center overflow-y-auto bg-neutral-900/90 py-8 px-4"
      >
        <div className="flex flex-col items-center">
          {pageNumbers.map((pageNum) => (
            <PdfPageItem
              key={`${activeTab.id}-p${pageNum}-${activeTab.scale}-${activeTab.rotation}`}
              pageNum={pageNum}
              pdfDoc={pdfDoc}
              scale={activeTab.scale}
              rotation={activeTab.rotation}
              defaultPageSize={defaultPageSize}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
