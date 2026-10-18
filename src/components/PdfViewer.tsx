import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Loader2, AlertCircle } from "lucide-react";
import { usePdfStore, type PdfTab } from "../store/usePdfStore";

// Initialize PDF.js worker using Vite URL resolution
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PageItemProps {
  pageNum: number;
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  scale: number;
  rotation: number;
  defaultPageSize: { width: number; height: number };
}

/**
 * Renders an individual PDF page onto a canvas with HiDPI support and rotation.
 * Pre-sets container dimensions immediately to eliminate layout shifts.
 */
function PdfPageItem({
  pageNum,
  pdfDoc,
  scale,
  rotation,
  defaultPageSize,
}: PageItemProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function renderPage() {
      if (!canvasRef.current || !pdfDoc) return;

      try {
        const page = await pdfDoc.getPage(pageNum);
        if (isCancelled) return;

        // Obtain exact viewport for this specific page immediately
        const viewport = page.getViewport({ scale, rotation });
        setPageSize({ width: viewport.width, height: viewport.height });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        // Scale context to account for device pixel ratio
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        // Cancel previous render task if still active
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

  const width = pageSize ? pageSize.width : defaultPageSize.width;
  const height = pageSize ? pageSize.height : defaultPageSize.height;

  return (
    <div
      id={`pdf-page-${pageNum}`}
      data-page-number={pageNum}
      className="relative mb-6 rounded bg-white shadow-2xl transition-shadow duration-150"
      style={{
        width: `${width}px`,
        minHeight: `${height}px`,
      }}
    >
      <canvas ref={canvasRef} className="block rounded" />
      <div className="absolute bottom-2 right-2 rounded bg-neutral-900/60 px-1.5 py-0.5 text-[10px] font-mono text-white/70 backdrop-blur-sm pointer-events-none">
        {pageNum}
      </div>
    </div>
  );
}

/**
 * Main PDF viewer component.
 * Distinguishes programmatic jumps from user manual scrolling to prevent feedback loops.
 */
export default function PdfViewer() {
  const {
    tabs,
    activeTabId,
    setNumPages,
    setCurrentPageFromScroll,
    clearScrollTarget,
    setPdfDoc,
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

    // Pass a fresh copy of the Uint8Array to avoid worker detached buffer issues
    const dataCopy = new Uint8Array(activeTab.data);

    const loadingTask = pdfjsLib.getDocument({
      data: dataCopy,
    });

    loadingTask.promise
      .then(async (loadedDoc) => {
        if (!isSubscribed) return;

        try {
          // Pre-fetch Page 1 to establish baseline dimensions and avoid initial layout shifts
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

      // Calculate relative offset within viewer container to prevent ancestor scroll shifts
      const targetTop = targetEl.offsetTop - container.offsetTop - 16;

      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "instant",
      });

      // Clear the target so manual scrolling does not re-trigger this effect
      clearScrollTarget();

      // Release the programmatic scroll lock after rendering settles
      requestAnimationFrame(() => {
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 80);
      });
    }
  }, [scrollTargetPage, clearScrollTarget]);

  // Track page visibility with IntersectionObserver during manual scrolling
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeTab || !pdfDoc) return;

    const pageElements = container.querySelectorAll("[data-page-number]");
    if (pageElements.length === 0) return;

    const visibilityMap = new Map<number, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        // Disregard observer events caused by programmatic instant jumps
        if (isProgrammaticScrollRef.current) return;

        entries.forEach((entry) => {
          const pageNum = parseInt(entry.target.getAttribute("data-page-number") || "1", 10);
          if (entry.isIntersecting) {
            visibilityMap.set(pageNum, entry.intersectionRatio);
          } else {
            visibilityMap.delete(pageNum);
          }
        });

        // Identify the page with highest viewport ratio
        let bestPage = activeTab.currentPage;
        let highestRatio = 0;

        visibilityMap.forEach((ratio, pageNum) => {
          if (ratio > highestRatio) {
            highestRatio = ratio;
            bestPage = pageNum;
          }
        });

        // Update currentPage in the store WITHOUT setting scrollTargetPage
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
  );
}
