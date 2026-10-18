import { useState, useEffect } from "react";
import {
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  PanelLeft,
  Maximize,
  MoveHorizontal,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { usePdfStore } from "../store/usePdfStore";

/**
 * Top application toolbar providing sidebar toggle, file opening,
 * page navigation, rotation, and zoom/fit controls.
 */
export default function Toolbar() {
  const {
    tabs,
    activeTabId,
    addTab,
    jumpToPage,
    setScale,
    rotateClockwise,
    isSidebarOpen,
    toggleSidebar,
    pdfDoc,
  } = usePdfStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Local state for the editable page input
  const [pageInput, setPageInput] = useState<string>("1");

  useEffect(() => {
    if (activeTab) {
      setPageInput(String(activeTab.currentPage));
    }
  }, [activeTab?.currentPage, activeTab?.id]);

  /**
   * Prompts user to select a PDF file, reads binary data, and opens as a new tab.
   */
  async function handleOpenFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF Files", extensions: ["pdf"] }],
      });

      if (!selected) return;

      const filePath = typeof selected === "string" ? selected : selected[0];
      if (!filePath) return;

      const fileName = filePath.split(/[/\\]/).pop() || "Document.pdf";
      const fileData = await readFile(filePath);

      addTab({
        name: fileName,
        path: filePath,
        data: fileData,
      });
    } catch (error) {
      console.error("Failed to open PDF file:", error);
    }
  }

  /**
   * Navigates to previous page if within bounds.
   */
  function handlePrevPage() {
    if (!activeTab || activeTab.currentPage <= 1) return;
    jumpToPage(activeTab.currentPage - 1);
  }

  /**
   * Navigates to next page if within bounds.
   */
  function handleNextPage() {
    if (!activeTab || activeTab.currentPage >= activeTab.numPages) return;
    jumpToPage(activeTab.currentPage + 1);
  }

  /**
   * Commits the page number entered by the user.
   */
  function handlePageInputCommit() {
    if (!activeTab) return;
    const parsedPage = parseInt(pageInput, 10);
    if (!isNaN(parsedPage)) {
      jumpToPage(parsedPage);
    } else {
      setPageInput(String(activeTab.currentPage));
    }
  }

  /**
   * Decrements zoom scale by 15%.
   */
  function handleZoomOut() {
    if (!activeTab) return;
    setScale(activeTab.id, Math.round((activeTab.scale - 0.15) * 100) / 100);
  }

  /**
   * Increments zoom scale by 15%.
   */
  function handleZoomIn() {
    if (!activeTab) return;
    setScale(activeTab.id, Math.round((activeTab.scale + 0.15) * 100) / 100);
  }

  /**
   * Resets zoom scale to 100%.
   */
  function handleResetZoom() {
    if (!activeTab) return;
    setScale(activeTab.id, 1.0);
  }

  /**
   * Rotates the active document pages clockwise by 90 degrees.
   */
  function handleRotate() {
    if (!activeTab) return;
    rotateClockwise(activeTab.id);
  }

  /**
   * Calculates scale to fit the active page horizontally within the viewer container.
   */
  async function handleFitWidth() {
    if (!activeTab || !pdfDoc) return;
    try {
      const page = await pdfDoc.getPage(activeTab.currentPage || 1);
      const baseViewport = page.getViewport({ scale: 1.0, rotation: activeTab.rotation });
      const viewerContainer = document.getElementById("pdf-viewer-container");
      const availableWidth = viewerContainer ? viewerContainer.clientWidth - 64 : 800;
      const fitWidthScale = Math.max(0.25, Math.min(availableWidth / baseViewport.width, 5.0));
      setScale(activeTab.id, Math.round(fitWidthScale * 100) / 100);
    } catch (e) {
      console.error("Failed to fit width:", e);
    }
  }

  /**
   * Calculates scale to fit the entire active page within the viewer container.
   */
  async function handleFitPage() {
    if (!activeTab || !pdfDoc) return;
    try {
      const page = await pdfDoc.getPage(activeTab.currentPage || 1);
      const baseViewport = page.getViewport({ scale: 1.0, rotation: activeTab.rotation });
      const viewerContainer = document.getElementById("pdf-viewer-container");
      const availableWidth = viewerContainer ? viewerContainer.clientWidth - 64 : 800;
      const availableHeight = viewerContainer ? viewerContainer.clientHeight - 64 : 800;
      const scaleW = availableWidth / baseViewport.width;
      const scaleH = availableHeight / baseViewport.height;
      const fitPageScale = Math.max(0.25, Math.min(Math.min(scaleW, scaleH), 5.0));
      setScale(activeTab.id, Math.round(fitPageScale * 100) / 100);
    } catch (e) {
      console.error("Failed to fit page:", e);
    }
  }

  return (
    <div className="flex h-11 items-center justify-between border-b border-neutral-800 bg-neutral-900/90 px-3 text-xs backdrop-blur-md select-none">
      {/* Left controls: Sidebar toggle & Open button */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleSidebar}
          className={`rounded p-1.5 transition-colors ${
            isSidebarOpen
              ? "bg-neutral-800 text-neutral-100"
              : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
          }`}
          title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <div className="h-4 w-[1px] bg-neutral-800" />

        <button
          type="button"
          onClick={handleOpenFile}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1 font-medium text-white shadow-sm transition hover:bg-red-500 active:bg-red-700"
          title="Open a PDF document"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span>Open PDF</span>
        </button>
      </div>

      {/* Navigation Controls (Page switcher) */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handlePrevPage}
          disabled={!activeTab || activeTab.currentPage <= 1}
          className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
          title="Previous Page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-1.5 px-1 font-mono text-neutral-300">
          <input
            type="text"
            value={pageInput}
            disabled={!activeTab}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handlePageInputCommit();
              }
            }}
            onBlur={handlePageInputCommit}
            className="w-10 rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-center text-xs text-neutral-100 outline-none focus:border-red-500 disabled:opacity-40"
          />
          <span className="text-neutral-500">/</span>
          <span className="text-neutral-400">
            {activeTab && activeTab.numPages > 0 ? activeTab.numPages : 1}
          </span>
        </div>

        <button
          type="button"
          onClick={handleNextPage}
          disabled={!activeTab || activeTab.currentPage >= activeTab.numPages}
          className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
          title="Next Page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Zoom, Rotation, and Fit Controls */}
      <div className="flex items-center gap-1">
        {/* Rotate Button */}
        <button
          type="button"
          onClick={handleRotate}
          disabled={!activeTab}
          className="rounded p-1.5 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          title="Rotate 90° Clockwise"
        >
          <RotateCw className="h-4 w-4" />
        </button>

        <div className="h-4 w-[1px] bg-neutral-800 mx-0.5" />

        {/* Fit to Width Button */}
        <button
          type="button"
          onClick={handleFitWidth}
          disabled={!activeTab}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          title="Fit to Width"
        >
          <MoveHorizontal className="h-3.5 w-3.5" />
          <span className="text-[11px]">Fit Width</span>
        </button>

        {/* Fit to Page Button */}
        <button
          type="button"
          onClick={handleFitPage}
          disabled={!activeTab}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          title="Fit to Page"
        >
          <Maximize className="h-3.5 w-3.5" />
          <span className="text-[11px]">Fit Page</span>
        </button>

        <div className="h-4 w-[1px] bg-neutral-800 mx-0.5" />

        {/* Zoom Out */}
        <button
          type="button"
          onClick={handleZoomOut}
          disabled={!activeTab || activeTab.scale <= 0.3}
          className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>

        {/* Zoom Percentage */}
        <button
          type="button"
          onClick={handleResetZoom}
          disabled={!activeTab}
          className="min-w-[48px] rounded px-1.5 py-0.5 font-mono text-center text-[11px] text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          title="Reset zoom to 100%"
        >
          {activeTab ? `${Math.round(activeTab.scale * 100)}%` : "100%"}
        </button>

        {/* Zoom In */}
        <button
          type="button"
          onClick={handleZoomIn}
          disabled={!activeTab || activeTab.scale >= 4.0}
          className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </button>

        {/* Reset Zoom */}
        <button
          type="button"
          onClick={handleResetZoom}
          disabled={!activeTab}
          className="rounded p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          title="Reset Zoom"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
