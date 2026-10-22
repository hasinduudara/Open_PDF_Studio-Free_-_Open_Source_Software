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
  Search,
  Moon,
  Sun,
  MousePointer,
  Highlighter,
  MessageSquarePlus,
  Pen,
  Undo2,
  Download,
  Check,
  Loader2,
  Layers,
  Stamp,
  Hash,
  FileArchive,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { usePdfStore } from "../store/usePdfStore";
import { saveAnnotatedPdf } from "../utils/pdfSaver";

/**
 * Top application toolbar providing sidebar toggle, file opening, saving,
 * page navigation, annotation tools, search, and zoom/fit controls.
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
    isSearchOpen,
    openSearch,
    closeSearch,
    isDarkPageMode,
    toggleDarkPageMode,
    activeTool,
    setActiveTool,
    activeColor,
    setActiveColor,
    undoLastAnnotation,
    openPageTools,
  } = usePdfStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Local state for the editable page input
  const [pageInput, setPageInput] = useState<string>("1");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab) {
      setPageInput(String(activeTab.currentPage));
    }
  }, [activeTab?.currentPage, activeTab?.id]);

  /**
   * Prompts user for destination path and writes annotated PDF bytes to disk.
   */
  async function handleSavePdf() {
    if (!activeTab || isSaving) return;
    try {
      setIsSaving(true);
      setSaveStatus("Saving...");
      const savedPath = await saveAnnotatedPdf(activeTab);
      if (savedPath) {
        setSaveStatus("Saved!");
        setTimeout(() => setSaveStatus(null), 2500);
      } else {
        setSaveStatus(null);
      }
    } catch (err) {
      console.error("Failed to save annotated PDF:", err);
      setSaveStatus("Failed");
      setTimeout(() => setSaveStatus(null), 2500);
    } finally {
      setIsSaving(false);
    }
  }

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
          className={`rounded p-1.5 transition-colors cursor-pointer ${
            isSidebarOpen
              ? "bg-neutral-800 text-neutral-100"
              : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
          }`}
          title={isSidebarOpen ? "Collapse Left Sidebar" : "Expand Left Sidebar"}
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <div className="h-4 w-[1px] bg-neutral-800" />

        <button
          type="button"
          onClick={handleOpenFile}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1 font-medium text-white shadow-sm transition hover:bg-red-500 active:bg-red-700 cursor-pointer"
          title="Open PDF Document (Ctrl+O)"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span>Open PDF</span>
        </button>

        {/* Save Annotated PDF Button */}
        <button
          type="button"
          onClick={handleSavePdf}
          disabled={!activeTab || isSaving}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 py-1 font-medium text-neutral-200 transition hover:bg-neutral-700 active:bg-neutral-850 hover:text-white disabled:opacity-40 cursor-pointer"
          title="Save Annotated PDF (Ctrl+S)"
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
          ) : saveStatus === "Saved!" ? (
            <Check className="h-3.5 w-3.5 text-green-400" />
          ) : (
            <Download className="h-3.5 w-3.5 text-neutral-300" />
          )}
          <span>{saveStatus || "Save As"}</span>
        </button>

        {/* Page & File Tools Button */}
        <button
          type="button"
          onClick={() => openPageTools(activeTab ? "organize" : "merge")}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 py-1 font-medium text-neutral-200 transition hover:bg-neutral-700 active:bg-neutral-850 hover:text-white cursor-pointer"
          title="Organize, Merge & Split Pages (Page Tools)"
        >
          <Layers className="h-3.5 w-3.5 text-amber-400" />
          <span>Page Tools</span>
        </button>

        {/* Watermark Button */}
        <button
          type="button"
          onClick={() => openPageTools("watermark")}
          disabled={!activeTab}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 py-1 font-medium text-neutral-200 transition hover:bg-neutral-700 active:bg-neutral-850 hover:text-white disabled:opacity-40 cursor-pointer"
          title="Add Text or Image Watermark (Stamp)"
        >
          <Stamp className="h-3.5 w-3.5 text-purple-400" />
          <span>Watermark</span>
        </button>

        {/* Headers, Footers & Page Numbers Button */}
        <button
          type="button"
          onClick={() => openPageTools("header-footer")}
          disabled={!activeTab}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 py-1 font-medium text-neutral-200 transition hover:bg-neutral-700 active:bg-neutral-850 hover:text-white disabled:opacity-40 cursor-pointer"
          title="Add Headers, Footers & Page Numbers"
        >
          <Hash className="h-3.5 w-3.5 text-rose-400" />
          <span>Page Numbers</span>
        </button>

        {/* Convert & Compress Button */}
        <button
          type="button"
          onClick={() => openPageTools("convert")}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 py-1 font-medium text-neutral-200 transition hover:bg-neutral-700 active:bg-neutral-850 hover:text-white cursor-pointer"
          title="Convert Images to PDF, PDF to Images & Compress PDF"
        >
          <FileArchive className="h-3.5 w-3.5 text-cyan-400" />
          <span>Convert</span>
        </button>
      </div>

      {/* Navigation Controls (Page switcher) */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handlePrevPage}
          disabled={!activeTab || activeTab.currentPage <= 1}
          className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
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
            title="Current Page (Press Enter to jump)"
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
          className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
          title="Next Page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Annotation Tools & Color Palette */}
      <div className="flex items-center gap-1 bg-neutral-950/70 p-0.5 rounded-lg border border-neutral-800/80">
        {/* Select Tool */}
        <button
          type="button"
          onClick={() => setActiveTool("select")}
          className={`rounded p-1.5 transition-colors cursor-pointer ${
            activeTool === "select"
              ? "bg-neutral-800 text-neutral-100 shadow-xs"
              : "text-neutral-400 hover:bg-neutral-800/60 hover:text-white"
          }`}
          title="Select / Cursor (V)"
        >
          <MousePointer className="h-3.5 w-3.5" />
        </button>

        {/* Highlight Tool */}
        <button
          type="button"
          onClick={() => setActiveTool("highlight")}
          disabled={!activeTab}
          className={`rounded p-1.5 transition-colors cursor-pointer ${
            activeTool === "highlight"
              ? "bg-neutral-800 text-amber-400 shadow-xs"
              : "text-neutral-400 hover:bg-neutral-800/60 hover:text-white disabled:opacity-40"
          }`}
          title="Highlight Area (H)"
        >
          <Highlighter className="h-3.5 w-3.5" />
        </button>

        {/* Sticky Note Tool */}
        <button
          type="button"
          onClick={() => setActiveTool("note")}
          disabled={!activeTab}
          className={`rounded p-1.5 transition-colors cursor-pointer ${
            activeTool === "note"
              ? "bg-neutral-800 text-blue-400 shadow-xs"
              : "text-neutral-400 hover:bg-neutral-800/60 hover:text-white disabled:opacity-40"
          }`}
          title="Add Sticky Note / Comment (N)"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>

        {/* Freehand Draw Tool */}
        <button
          type="button"
          onClick={() => setActiveTool("draw")}
          disabled={!activeTab}
          className={`rounded p-1.5 transition-colors cursor-pointer ${
            activeTool === "draw"
              ? "bg-neutral-800 text-emerald-400 shadow-xs"
              : "text-neutral-400 hover:bg-neutral-800/60 hover:text-white disabled:opacity-40"
          }`}
          title="Freehand Pen (P)"
        >
          <Pen className="h-3.5 w-3.5" />
        </button>

        <div className="h-3.5 w-[1px] bg-neutral-800 mx-0.5" />

        {/* Color Palette (Yellow, Green, Blue, Red + Custom Color Picker) */}
        <div className="flex items-center gap-1.5 px-1">
          {[
            { hex: "#facc15", name: "Yellow" },
            { hex: "#4ade80", name: "Green" },
            { hex: "#60a5fa", name: "Blue" },
            { hex: "#f87171", name: "Red" },
          ].map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => setActiveColor(c.hex)}
              className={`w-3.5 h-3.5 rounded-full transition-transform cursor-pointer ${
                activeColor.toLowerCase() === c.hex.toLowerCase()
                  ? "ring-2 ring-white ring-offset-1 ring-offset-neutral-900 scale-110"
                  : "opacity-60 hover:opacity-100 hover:scale-105"
              }`}
              style={{ backgroundColor: c.hex }}
              title={c.name}
            />
          ))}

          {/* Custom Color Picker */}
          <label
            className={`relative flex items-center justify-center w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110 overflow-hidden ${
              !["#facc15", "#4ade80", "#60a5fa", "#f87171"].includes(activeColor.toLowerCase())
                ? "ring-2 ring-white ring-offset-1 ring-offset-neutral-900 scale-110"
                : "opacity-75 hover:opacity-100"
            }`}
            title="Choose Custom Color"
            style={{
              background:
                "conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)",
            }}
          >
            <input
              type="color"
              value={activeColor}
              onChange={(e) => setActiveColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full p-0 border-0"
              title="Choose Custom Color"
            />
            <span
              className="w-1.5 h-1.5 rounded-full pointer-events-none border border-black/40"
              style={{
                backgroundColor: !["#facc15", "#4ade80", "#60a5fa", "#f87171"].includes(
                  activeColor.toLowerCase()
                )
                  ? activeColor
                  : "#ffffff",
              }}
            />
          </label>
        </div>

        <div className="h-3.5 w-[1px] bg-neutral-800 mx-0.5" />

        {/* Undo Last Annotation */}
        <button
          type="button"
          onClick={() => undoLastAnnotation(activeTab?.id)}
          disabled={!activeTab || (activeTab.annotations || []).length === 0}
          className="rounded p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
          title="Undo Last Annotation (Ctrl+Z)"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Zoom, Rotation, Fit, Search, and Dark Mode Controls */}
      <div className="flex items-center gap-1">
        {/* Find/Search Button */}
        <button
          type="button"
          onClick={isSearchOpen ? closeSearch : openSearch}
          disabled={!activeTab}
          className={`rounded p-1.5 transition-colors cursor-pointer ${
            isSearchOpen
              ? "bg-neutral-800 text-red-400"
              : "text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          }`}
          title={isSearchOpen ? "Close Search (Esc)" : "Find in Document (Ctrl+F)"}
        >
          <Search className="h-4 w-4" />
        </button>

        {/* Dark Reading Mode Button */}
        <button
          type="button"
          onClick={toggleDarkPageMode}
          disabled={!activeTab}
          className={`rounded p-1.5 transition-colors cursor-pointer ${
            isDarkPageMode
              ? "bg-neutral-800 text-amber-400"
              : "text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-40"
          }`}
          title={
            isDarkPageMode
              ? "Disable Dark Reading Mode (Normal Colors)"
              : "Enable Dark Reading Mode (Invert Colors)"
          }
        >
          {isDarkPageMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="h-4 w-[1px] bg-neutral-800 mx-0.5" />

        {/* Rotate Button */}
        <button
          type="button"
          onClick={handleRotate}
          disabled={!activeTab}
          className="rounded p-1.5 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 cursor-pointer"
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
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 cursor-pointer"
          title="Fit Page to Width"
        >
          <MoveHorizontal className="h-3.5 w-3.5" />
          <span className="text-[11px]">Fit Width</span>
        </button>

        {/* Fit to Page Button */}
        <button
          type="button"
          onClick={handleFitPage}
          disabled={!activeTab}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 cursor-pointer"
          title="Fit Entire Page to Window"
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
          className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 cursor-pointer"
          title="Zoom Out (Ctrl+-)"
        >
          <ZoomOut className="h-4 w-4" />
        </button>

        {/* Zoom Percentage */}
        <button
          type="button"
          onClick={handleResetZoom}
          disabled={!activeTab}
          className="min-w-[48px] rounded px-1.5 py-0.5 font-mono text-center text-[11px] text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 cursor-pointer"
          title="Reset Zoom to 100% (Ctrl+0)"
        >
          {activeTab ? `${Math.round(activeTab.scale * 100)}%` : "100%"}
        </button>

        {/* Zoom In */}
        <button
          type="button"
          onClick={handleZoomIn}
          disabled={!activeTab || activeTab.scale >= 4.0}
          className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 cursor-pointer"
          title="Zoom In (Ctrl+=)"
        >
          <ZoomIn className="h-4 w-4" />
        </button>

        {/* Reset Zoom */}
        <button
          type="button"
          onClick={handleResetZoom}
          disabled={!activeTab}
          className="rounded p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40 cursor-pointer"
          title="Reset Zoom to Default"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
