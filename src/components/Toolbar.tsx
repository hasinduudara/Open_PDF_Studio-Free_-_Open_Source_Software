import { useState, useEffect } from "react";
import {
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { usePdfStore } from "../store/usePdfStore";

/**
 * Top application toolbar providing file opening, page navigation,
 * and zoom adjustment controls for the active PDF tab.
 */
export default function Toolbar() {
  const { tabs, activeTabId, addTab, setPage, setScale } = usePdfStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Local state for the editable page input to allow typing without jitter
  const [pageInput, setPageInput] = useState<string>("1");

  useEffect(() => {
    if (activeTab) {
      setPageInput(String(activeTab.currentPage));
    }
  }, [activeTab?.currentPage, activeTab?.id]);

  /**
   * Prompts the user to select a PDF file using Tauri's native dialog,
   * reads its binary data, and opens it as a new tab in the store.
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

      // Extract filename from the selected file path
      const fileName = filePath.split(/[/\\]/).pop() || "Document.pdf";

      // Read file binary content as Uint8Array
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
    setPage(activeTab.id, activeTab.currentPage - 1);
  }

  /**
   * Navigates to next page if within bounds.
   */
  function handleNextPage() {
    if (!activeTab || activeTab.currentPage >= activeTab.numPages) return;
    setPage(activeTab.id, activeTab.currentPage + 1);
  }

  /**
   * Commits the page number entered by the user.
   */
  function handlePageInputCommit() {
    if (!activeTab) return;
    const parsedPage = parseInt(pageInput, 10);
    if (!isNaN(parsedPage)) {
      setPage(activeTab.id, parsedPage);
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

  return (
    <div className="flex h-11 items-center justify-between border-b border-neutral-800 bg-neutral-900/90 px-3 text-xs backdrop-blur-md select-none">
      {/* File Action Controls */}
      <div className="flex items-center gap-2">
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

      {/* Zoom Controls */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleZoomOut}
          disabled={!activeTab || activeTab.scale <= 0.3}
          className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={handleResetZoom}
          disabled={!activeTab}
          className="min-w-[48px] rounded px-1.5 py-0.5 font-mono text-center text-[11px] text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          title="Click to reset zoom to 100%"
        >
          {activeTab ? `${Math.round(activeTab.scale * 100)}%` : "100%"}
        </button>

        <button
          type="button"
          onClick={handleZoomIn}
          disabled={!activeTab || activeTab.scale >= 4.0}
          className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </button>

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
