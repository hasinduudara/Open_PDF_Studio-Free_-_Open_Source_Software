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
}

/**
 * Renders an individual PDF page onto a canvas with HiDPI support.
 */
function PdfPageItem({ pageNum, pdfDoc, scale }: PageItemProps) {
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

        const viewport = page.getViewport({ scale });
        setPageSize({ width: viewport.width, height: viewport.height });

        const canvas = canvasRef.current;
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
  }, [pageNum, pdfDoc, scale]);

  return (
    <div
      id={`pdf-page-${pageNum}`}
      data-page-number={pageNum}
      className="relative mb-6 rounded bg-white shadow-2xl transition-all duration-150"
      style={{
        width: pageSize ? `${pageSize.width}px` : "auto",
        minHeight: pageSize ? `${pageSize.height}px` : "200px",
      }}
    >
      <canvas ref={canvasRef} className="block rounded" />
      <div className="absolute bottom-2 right-2 rounded bg-neutral-900/60 px-1.5 py-0.5 text-[10px] font-mono text-white/70 backdrop-blur-sm">
        {pageNum}
      </div>
    </div>
  );
}

/**
 * Main PDF viewer component responsible for loading document proxy,
 * rendering all pages vertically, and tracking the active page on scroll.
 */
export default function PdfViewer() {
  const { tabs, activeTabId, setNumPages, setPage } = usePdfStore();
  const activeTab: PdfTab | undefined = tabs.find((t) => t.id === activeTabId);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);

  // Load document whenever active tab changes
  useEffect(() => {
    if (!activeTab || !activeTab.data) {
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
      .then((loadedDoc) => {
        if (!isSubscribed) return;
        setPdfDoc(loadedDoc);
        setNumPages(activeTab.id, loadedDoc.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (!isSubscribed) return;
        console.error("Failed to load PDF document:", err);
        setErrorMsg("Failed to parse and load PDF document.");
        setLoading(false);
      });

    return () => {
      isSubscribed = false;
      loadingTask.destroy();
    };
  }, [activeTab?.id, activeTab?.data, setNumPages]);

  // Handle scrolling to page when currentPage changes from toolbar
  useEffect(() => {
    if (!activeTab || !containerRef.current) return;

    const pageElement = document.getElementById(`pdf-page-${activeTab.currentPage}`);
    if (pageElement && containerRef.current) {
      // Mark programmatic scroll to prevent feedback loop in scroll listener
      isProgrammaticScrollRef.current = true;
      if (programmaticScrollTimerRef.current) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }

      pageElement.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      programmaticScrollTimerRef.current = window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 600);
    }
  }, [activeTab?.currentPage, activeTab?.id]);

  // Track user scroll position to update current page in store
  function handleScroll() {
    if (isProgrammaticScrollRef.current || !containerRef.current || !activeTab || !pdfDoc) {
      return;
    }

    const containerTop = containerRef.current.getBoundingClientRect().top;
    const pageElements = containerRef.current.querySelectorAll("[data-page-number]");

    let closestPageNum = activeTab.currentPage;
    let minDistance = Infinity;

    pageElements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const distance = Math.abs(rect.top - containerTop - 40);
      if (distance < minDistance) {
        minDistance = distance;
        const pageNum = parseInt(el.getAttribute("data-page-number") || "1", 10);
        closestPageNum = pageNum;
      }
    });

    if (closestPageNum !== activeTab.currentPage) {
      setPage(activeTab.id, closestPageNum);
    }
  }

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
      ref={containerRef}
      onScroll={handleScroll}
      className="flex flex-1 justify-center overflow-y-auto bg-neutral-900/90 py-8 px-4"
    >
      <div className="flex flex-col items-center">
        {pageNumbers.map((pageNum) => (
          <PdfPageItem
            key={`${activeTab.id}-p${pageNum}-${activeTab.scale}`}
            pageNum={pageNum}
            pdfDoc={pdfDoc}
            scale={activeTab.scale}
          />
        ))}
      </div>
    </div>
  );
}
