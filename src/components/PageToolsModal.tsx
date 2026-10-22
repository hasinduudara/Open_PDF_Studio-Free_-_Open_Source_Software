import { useState, useEffect, useRef } from "react";
import type * as pdfjsLib from "pdfjs-dist";
import { PDFDocument } from "pdf-lib";
import {
  Layers,
  LayoutGrid,
  Scissors,
  FilePlus,
  RotateCw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Check,
  CheckSquare,
  Square,
  Download,
  Save,
  FolderOpen,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FolderDown,
  RefreshCw,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { usePdfStore, type PdfTab } from "../store/usePdfStore";
import {
  mergePdfFiles,
  applyPageOperations,
  splitPdfByRanges,
  parsePageRanges,
  generateEveryNPageRanges,
  type PageOperation,
} from "../utils/pdfPageTools";

interface PageCardItem {
  id: string;
  originalPageIndex: number; // 0-based
  rotationDelta: number; // 0, 90, 180, 270
  selected: boolean;
}

interface QueuedMergeFile {
  id: string;
  name: string;
  path: string;
  data: Uint8Array;
  pageCount: number;
}

/**
 * Renders a lightweight canvas thumbnail of a specific PDF page.
 */
function PageCardThumbnail({
  pdfDoc,
  originalPageNum,
  rotationDelta,
}: {
  pdfDoc: pdfjsLib.PDFDocumentProxy | null;
  originalPageNum: number;
  rotationDelta: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    const doc = pdfDoc;
    let isCancelled = false;

    async function renderThumb() {
      try {
        const page = await doc.getPage(originalPageNum);
        if (isCancelled) return;

        const viewport = page.getViewport({ scale: 0.22, rotation: rotationDelta });
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

        const renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
        });

        await renderTask.promise;
      } catch {
        // Ignored if cancelled
      }
    }

    renderThumb();

    return () => {
      isCancelled = true;
    };
  }, [pdfDoc, originalPageNum, rotationDelta]);

  return (
    <div className="flex items-center justify-center h-36 bg-neutral-950/60 rounded-md overflow-hidden p-1.5">
      <canvas
        ref={canvasRef}
        className="rounded shadow-sm max-h-full max-w-full object-contain"
      />
    </div>
  );
}

/**
 * Unified modal dialog for organizing pages, merging multiple documents, and splitting PDFs.
 */
export default function PageToolsModal() {
  const {
    isPageToolsOpen,
    pageToolsInitialTab,
    closePageTools,
    tabs,
    activeTabId,
    pdfDoc,
    addTab,
    updateTabData,
  } = usePdfStore();

  const activeTab: PdfTab | undefined = tabs.find((t) => t.id === activeTabId);

  // Active sub-tab inside the modal
  const [currentTab, setCurrentTab] = useState<"organize" | "merge" | "split">(
    pageToolsInitialTab
  );

  // Update currentTab when pageToolsInitialTab changes
  useEffect(() => {
    if (isPageToolsOpen) {
      setCurrentTab(pageToolsInitialTab);
    }
  }, [isPageToolsOpen, pageToolsInitialTab]);

  // Loading & status feedback
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ==========================================
  // TAB 1: ORGANIZE PAGES STATE
  // ==========================================
  const [pageCards, setPageCards] = useState<PageCardItem[]>([]);

  // Initialize page cards whenever activeTab changes or modal opens
  useEffect(() => {
    if (activeTab && activeTab.numPages > 0) {
      const initialCards: PageCardItem[] = Array.from(
        { length: activeTab.numPages },
        (_, i) => ({
          id: `page-card-${i}-${Date.now()}`,
          originalPageIndex: i,
          rotationDelta: 0,
          selected: true,
        })
      );
      setPageCards(initialCards);
    } else {
      setPageCards([]);
    }
    setErrorMessage(null);
    setStatusMessage(null);
  }, [activeTab?.id, activeTab?.numPages, isPageToolsOpen]);

  function handleToggleSelect(index: number) {
    setPageCards((prev) =>
      prev.map((c, i) => (i === index ? { ...c, selected: !c.selected } : c))
    );
  }

  function handleSelectAll(select: boolean) {
    setPageCards((prev) => prev.map((c) => ({ ...c, selected: select })));
  }

  function handleMoveLeft(index: number) {
    if (index <= 0) return;
    setPageCards((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  }

  function handleMoveRight(index: number) {
    if (index >= pageCards.length - 1) return;
    setPageCards((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  }

  function handleRotatePage(index: number) {
    setPageCards((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, rotationDelta: (c.rotationDelta + 90) % 360 } : c
      )
    );
  }

  function handleDeletePage(index: number) {
    if (pageCards.length <= 1) {
      setErrorMessage("A PDF document must retain at least one page.");
      return;
    }
    setPageCards((prev) => prev.filter((_, i) => i !== index));
  }

  function handleResetOrganize() {
    if (!activeTab) return;
    const initialCards: PageCardItem[] = Array.from(
      { length: activeTab.numPages },
      (_, i) => ({
        id: `page-card-${i}-${Date.now()}`,
        originalPageIndex: i,
        rotationDelta: 0,
        selected: true,
      })
    );
    setPageCards(initialCards);
    setErrorMessage(null);
  }

  async function handleApplyOrganize() {
    if (!activeTab || pageCards.length === 0) return;
    try {
      setIsProcessing(true);
      setErrorMessage(null);

      const ops: PageOperation[] = pageCards.map((c) => ({
        originalPageIndex: c.originalPageIndex,
        rotationDelta: c.rotationDelta,
      }));

      const newPdfBytes = await applyPageOperations(activeTab.data, ops);

      const defaultName = activeTab.name.endsWith(".pdf")
        ? activeTab.name
        : `${activeTab.name}.pdf`;

      const targetPath = await save({
        defaultPath: defaultName,
        filters: [{ name: "PDF Files", extensions: ["pdf"] }],
      });

      if (!targetPath) {
        setIsProcessing(false);
        return;
      }

      await writeFile(targetPath, newPdfBytes);

      // Refresh current tab data with updated PDF bytes
      updateTabData(activeTab.id, newPdfBytes);

      setStatusMessage("Document updated and saved successfully!");
      setTimeout(() => {
        closePageTools();
      }, 1200);
    } catch (err) {
      console.error("Apply organize failed:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to apply page organization."
      );
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleExtractSelected() {
    if (!activeTab) return;
    const selectedCards = pageCards.filter((c) => c.selected);
    if (selectedCards.length === 0) {
      setErrorMessage("Please select at least one page to extract.");
      return;
    }

    try {
      setIsProcessing(true);
      setErrorMessage(null);

      const ops: PageOperation[] = selectedCards.map((c) => ({
        originalPageIndex: c.originalPageIndex,
        rotationDelta: c.rotationDelta,
      }));

      const extractedBytes = await applyPageOperations(activeTab.data, ops);

      const baseName = activeTab.name.replace(/\.pdf$/i, "");
      const defaultName = `${baseName}_extracted.pdf`;

      const targetPath = await save({
        defaultPath: defaultName,
        filters: [{ name: "PDF Files", extensions: ["pdf"] }],
      });

      if (!targetPath) {
        setIsProcessing(false);
        return;
      }

      await writeFile(targetPath, extractedBytes);

      // Open extracted document as a new tab
      const fileName = targetPath.split(/[/\\]/).pop() || defaultName;
      addTab({
        name: fileName,
        path: targetPath,
        data: extractedBytes,
      });

      setStatusMessage("Pages extracted and saved successfully!");
      setTimeout(() => {
        closePageTools();
      }, 1200);
    } catch (err) {
      console.error("Extraction failed:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to extract pages."
      );
    } finally {
      setIsProcessing(false);
    }
  }

  // ==========================================
  // TAB 2: MERGE PDFS STATE
  // ==========================================
  const [queuedFiles, setQueuedFiles] = useState<QueuedMergeFile[]>([]);

  async function handleAddMergeFiles() {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "PDF Files", extensions: ["pdf"] }],
      });

      if (!selected) return;

      const filePaths = Array.isArray(selected) ? selected : [selected];
      const newItems: QueuedMergeFile[] = [];

      for (const p of filePaths) {
        if (!p) continue;
        try {
          const fileData = await readFile(p);
          const doc = await PDFDocument.load(fileData, { ignoreEncryption: true });
          const count = doc.getPageCount();
          const fileName = p.split(/[/\\]/).pop() || "Document.pdf";

          newItems.push({
            id: `merge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: fileName,
            path: p,
            data: fileData,
            pageCount: count,
          });
        } catch (readErr) {
          console.warn(`Failed reading file ${p}:`, readErr);
        }
      }

      setQueuedFiles((prev) => [...prev, ...newItems]);
      setErrorMessage(null);
    } catch (err) {
      console.error("Error selecting files for merge:", err);
    }
  }

  function handleIncludeOpenTabs() {
    const existingIds = new Set(queuedFiles.map((f) => f.path));
    const newItems: QueuedMergeFile[] = [];

    for (const tab of tabs) {
      if (tab.data && (!tab.path || !existingIds.has(tab.path))) {
        newItems.push({
          id: `tab-${tab.id}-${Date.now()}`,
          name: tab.name,
          path: tab.path,
          data: tab.data,
          pageCount: tab.numPages,
        });
      }
    }

    if (newItems.length > 0) {
      setQueuedFiles((prev) => [...prev, ...newItems]);
    }
  }

  function handleMoveMergeItem(index: number, direction: "up" | "down") {
    if (direction === "up" && index > 0) {
      setQueuedFiles((prev) => {
        const copy = [...prev];
        const temp = copy[index - 1];
        copy[index - 1] = copy[index];
        copy[index] = temp;
        return copy;
      });
    } else if (direction === "down" && index < queuedFiles.length - 1) {
      setQueuedFiles((prev) => {
        const copy = [...prev];
        const temp = copy[index + 1];
        copy[index + 1] = copy[index];
        copy[index] = temp;
        return copy;
      });
    }
  }

  function handleRemoveMergeItem(index: number) {
    setQueuedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleExecuteMerge() {
    if (queuedFiles.length < 2) {
      setErrorMessage("Please add at least 2 PDF files to combine.");
      return;
    }

    try {
      setIsProcessing(true);
      setErrorMessage(null);

      const mergedBytes = await mergePdfFiles(queuedFiles);

      const targetPath = await save({
        defaultPath: "Merged_Document.pdf",
        filters: [{ name: "PDF Files", extensions: ["pdf"] }],
      });

      if (!targetPath) {
        setIsProcessing(false);
        return;
      }

      await writeFile(targetPath, mergedBytes);

      const fileName = targetPath.split(/[/\\]/).pop() || "Merged_Document.pdf";
      addTab({
        name: fileName,
        path: targetPath,
        data: mergedBytes,
      });

      setStatusMessage("Documents merged and opened successfully!");
      setTimeout(() => {
        closePageTools();
      }, 1200);
    } catch (err) {
      console.error("Merge error:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to merge PDF files."
      );
    } finally {
      setIsProcessing(false);
    }
  }

  // ==========================================
  // TAB 3: SPLIT PDF STATE
  // ==========================================
  const [splitMode, setSplitMode] = useState<"ranges" | "everyN">("ranges");
  const [rangeInput, setRangeInput] = useState<string>("1-2, 3-4");
  const [everyNInput, setEveryNInput] = useState<number>(2);

  // Auto-generate sample range string when activeTab changes
  useEffect(() => {
    if (activeTab && activeTab.numPages > 0) {
      const mid = Math.max(1, Math.floor(activeTab.numPages / 2));
      if (activeTab.numPages <= 3) {
        setRangeInput("1, 2");
      } else {
        setRangeInput(`1-${mid}, ${mid + 1}-${activeTab.numPages}`);
      }
    }
  }, [activeTab?.id, activeTab?.numPages]);

  // Preview computed split ranges
  const computedRanges = (() => {
    if (!activeTab || activeTab.numPages <= 0) return [];
    const inputStr =
      splitMode === "ranges"
        ? rangeInput
        : generateEveryNPageRanges(activeTab.numPages, everyNInput);
    return parsePageRanges(inputStr, activeTab.numPages);
  })();

  async function handleExecuteSplit() {
    if (!activeTab) return;
    if (computedRanges.length === 0) {
      setErrorMessage("Please enter valid page ranges.");
      return;
    }

    try {
      setIsProcessing(true);
      setErrorMessage(null);

      const inputStr =
        splitMode === "ranges"
          ? rangeInput
          : generateEveryNPageRanges(activeTab.numPages, everyNInput);

      const parts = await splitPdfByRanges(activeTab.data, inputStr);

      // Choose destination folder via directory picker
      const destFolder = await open({
        directory: true,
        title: "Select Destination Folder for Split PDFs",
      });

      if (!destFolder || typeof destFolder !== "string") {
        setIsProcessing(false);
        return;
      }

      const baseName = activeTab.name.replace(/\.pdf$/i, "");
      let firstPartPath: string | null = null;
      let firstPartBytes: Uint8Array | null = null;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const fileName = `${baseName}_${part.label}.pdf`;
        const filePath = `${destFolder}\\${fileName}`;

        await writeFile(filePath, part.data);

        if (i === 0) {
          firstPartPath = filePath;
          firstPartBytes = part.data;
        }
      }

      // Automatically open the first split document in viewer
      if (firstPartPath && firstPartBytes) {
        const firstPartName = firstPartPath.split(/[/\\]/).pop() || "Part_1.pdf";
        addTab({
          name: firstPartName,
          path: firstPartPath,
          data: firstPartBytes,
        });
      }

      setStatusMessage(
        `Successfully saved ${parts.length} PDF files to selected folder!`
      );
      setTimeout(() => {
        closePageTools();
      }, 1500);
    } catch (err) {
      console.error("Split error:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to split document."
      );
    } finally {
      setIsProcessing(false);
    }
  }

  if (!isPageToolsOpen) {
    return null;
  }

  const selectedCount = pageCards.filter((c) => c.selected).length;
  const totalMergePages = queuedFiles.reduce((acc, f) => acc + f.pageCount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-5xl h-[86vh] max-h-[820px] flex flex-col rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl overflow-hidden text-neutral-100">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-950/40">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-600/20 text-red-400 ring-1 ring-red-500/30">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight">
                Page & File Tools
              </h2>
              <p className="text-xs text-neutral-400">
                Organize, merge, rotate, split, and extract PDF pages
              </p>
            </div>
          </div>

          {/* Sub-tab Navigation */}
          <div className="flex items-center rounded-lg bg-neutral-950/80 p-1 border border-neutral-800 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setCurrentTab("organize");
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                currentTab === "organize"
                  ? "bg-neutral-800 text-white shadow-xs"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5 text-amber-400" />
              <span>Organize Pages</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCurrentTab("merge");
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                currentTab === "merge"
                  ? "bg-neutral-800 text-white shadow-xs"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <FilePlus className="h-3.5 w-3.5 text-blue-400" />
              <span>Merge PDFs</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCurrentTab("split");
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                currentTab === "split"
                  ? "bg-neutral-800 text-white shadow-xs"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Scissors className="h-3.5 w-3.5 text-emerald-400" />
              <span>Split PDF</span>
            </button>
          </div>

          {/* Close Modal Button */}
          <button
            type="button"
            onClick={closePageTools}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Global Feedback Banner */}
        {errorMessage && (
          <div className="flex items-center gap-2 px-6 py-2.5 bg-red-950/60 border-b border-red-800/80 text-xs text-red-200">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {statusMessage && (
          <div className="flex items-center gap-2 px-6 py-2.5 bg-green-950/60 border-b border-green-800/80 text-xs text-green-200">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-400" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Modal Main Body Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* ======================================================== */}
          {/* TAB 1: ORGANIZE PAGES */}
          {/* ======================================================== */}
          {currentTab === "organize" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {!activeTab ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-neutral-400">
                  <LayoutGrid className="h-12 w-12 text-neutral-600 mb-3" />
                  <h3 className="text-sm font-semibold text-neutral-200 mb-1">
                    No Active Document
                  </h3>
                  <p className="text-xs max-w-sm mb-4">
                    Open a PDF document in Open PDF Studio to reorder, rotate, or delete its pages.
                  </p>
                  <button
                    type="button"
                    onClick={() => setCurrentTab("merge")}
                    className="rounded-lg bg-neutral-800 px-3.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 transition-colors cursor-pointer"
                  >
                    Go to Merge PDFs
                  </button>
                </div>
              ) : (
                <>
                  {/* Organize Action Toolbar */}
                  <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-800 bg-neutral-950/20 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-neutral-200">
                        {activeTab.name}
                      </span>
                      <span className="text-neutral-500">•</span>
                      <span className="text-neutral-400">
                        Total Pages: <b className="text-neutral-200">{pageCards.length}</b>
                      </span>
                      <span className="text-neutral-500">•</span>
                      <span className="text-neutral-400">
                        Selected: <b className="text-amber-400">{selectedCount}</b>
                      </span>

                      <div className="h-4 w-[1px] bg-neutral-800 mx-1" />

                      <button
                        type="button"
                        onClick={() => handleSelectAll(true)}
                        className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectAll(false)}
                        className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
                      >
                        Deselect All
                      </button>
                      <button
                        type="button"
                        onClick={handleResetOrganize}
                        className="flex items-center gap-1 text-neutral-400 hover:text-white transition-colors cursor-pointer ml-1"
                        title="Reset page ordering and rotation to initial state"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Reset</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleExtractSelected}
                        disabled={selectedCount === 0 || isProcessing}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 font-medium text-neutral-200 transition hover:bg-neutral-700 active:bg-neutral-850 hover:text-white disabled:opacity-40 cursor-pointer"
                        title="Extract selected pages into a new PDF"
                      >
                        <Download className="h-3.5 w-3.5 text-neutral-300" />
                        <span>Extract Selected ({selectedCount})</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleApplyOrganize}
                        disabled={pageCards.length === 0 || isProcessing}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 font-medium text-white transition hover:bg-red-500 active:bg-red-700 disabled:opacity-40 cursor-pointer shadow-sm"
                        title="Apply reordering/rotations and save changes to disk"
                      >
                        {isProcessing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        <span>Apply & Save As</span>
                      </button>
                    </div>
                  </div>

                  {/* Page Cards Grid */}
                  <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {pageCards.map((card, idx) => {
                        return (
                          <div
                            key={card.id}
                            className={`flex flex-col rounded-xl border bg-neutral-950 p-2.5 transition-all shadow-md group ${
                              card.selected
                                ? "border-amber-500/50 ring-1 ring-amber-500/30"
                                : "border-neutral-800 opacity-75 hover:opacity-100"
                            }`}
                          >
                            {/* Card Top: Checkbox and Position Badge */}
                            <div className="flex items-center justify-between pb-2">
                              <button
                                type="button"
                                onClick={() => handleToggleSelect(idx)}
                                className="text-neutral-400 hover:text-amber-400 cursor-pointer transition-colors"
                                title={card.selected ? "Deselect page" : "Select page"}
                              >
                                {card.selected ? (
                                  <CheckSquare className="h-4 w-4 text-amber-400" />
                                ) : (
                                  <Square className="h-4 w-4" />
                                )}
                              </button>

                              <div className="flex items-center gap-1 font-mono text-[10px] text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded">
                                <span className="font-semibold text-white">
                                  #{idx + 1}
                                </span>
                                {card.originalPageIndex + 1 !== idx + 1 && (
                                  <span className="text-neutral-500">
                                    (orig {card.originalPageIndex + 1})
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Center Thumbnail */}
                            <PageCardThumbnail
                              pdfDoc={pdfDoc}
                              originalPageNum={card.originalPageIndex + 1}
                              rotationDelta={card.rotationDelta}
                            />

                            {/* Card Bottom: Navigation & Manipulation Actions */}
                            <div className="flex items-center justify-between pt-2.5 border-t border-neutral-800/80 mt-1">
                              {/* Reorder Buttons */}
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => handleMoveLeft(idx)}
                                  disabled={idx === 0}
                                  className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-20 cursor-pointer"
                                  title="Move Left"
                                >
                                  <ChevronLeft className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveRight(idx)}
                                  disabled={idx === pageCards.length - 1}
                                  className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-20 cursor-pointer"
                                  title="Move Right"
                                >
                                  <ChevronRight className="h-3.5 w-3.5" />
                                </button>
                              </div>

                              {/* Rotate Button */}
                              <button
                                type="button"
                                onClick={() => handleRotatePage(idx)}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors text-[10px] cursor-pointer"
                                title="Rotate Page 90° Clockwise"
                              >
                                <RotateCw className="h-3 w-3" />
                                {card.rotationDelta > 0 && (
                                  <span className="text-[9px] text-amber-400">
                                    {card.rotationDelta}°
                                  </span>
                                )}
                              </button>

                              {/* Delete Button */}
                              <button
                                type="button"
                                onClick={() => handleDeletePage(idx)}
                                className="p-1 rounded text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                title="Remove Page"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 2: MERGE PDFS */}
          {/* ======================================================== */}
          {currentTab === "merge" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Action Toolbar */}
              <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-800 bg-neutral-950/20 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddMergeFiles}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 font-medium text-white shadow-sm transition hover:bg-red-500 active:bg-red-700 cursor-pointer"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>Add PDF Files</span>
                  </button>

                  {tabs.length > 0 && (
                    <button
                      type="button"
                      onClick={handleIncludeOpenTabs}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 font-medium text-neutral-200 transition hover:bg-neutral-700 hover:text-white cursor-pointer"
                      title="Add currently open tabs to merge list"
                    >
                      <Layers className="h-3.5 w-3.5 text-neutral-400" />
                      <span>Include Open Tabs</span>
                    </button>
                  )}

                  {queuedFiles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setQueuedFiles([])}
                      className="text-neutral-400 hover:text-white transition-colors cursor-pointer ml-2"
                    >
                      Clear List
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-neutral-400">
                    Files: <b className="text-white">{queuedFiles.length}</b>
                  </span>
                  <span className="text-neutral-500">•</span>
                  <span className="text-neutral-400">
                    Total Pages: <b className="text-white">{totalMergePages}</b>
                  </span>

                  <button
                    type="button"
                    onClick={handleExecuteMerge}
                    disabled={queuedFiles.length < 2 || isProcessing}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 font-medium text-white transition hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 cursor-pointer shadow-sm ml-2"
                  >
                    {isProcessing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    <span>Merge & Save PDF</span>
                  </button>
                </div>
              </div>

              {/* Merge Files List Area */}
              <div className="flex-1 overflow-y-auto p-6">
                {queuedFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full border-2 border-dashed border-neutral-800 rounded-xl p-8 text-center my-auto">
                    <FilePlus className="h-12 w-12 text-neutral-600 mb-3" />
                    <h3 className="text-sm font-semibold text-neutral-200 mb-1">
                      No Files in Merge Queue
                    </h3>
                    <p className="text-xs text-neutral-400 max-w-sm mb-4">
                      Add multiple PDF documents to combine them into one seamless document.
                    </p>
                    <button
                      type="button"
                      onClick={handleAddMergeFiles}
                      className="rounded-lg bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-700 transition-colors cursor-pointer"
                    >
                      Browse PDF Files
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 max-w-3xl mx-auto">
                    {queuedFiles.map((file, idx) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 p-3 shadow-xs hover:border-neutral-700 transition-colors"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-800 font-mono text-xs font-semibold text-neutral-300">
                            {idx + 1}
                          </span>
                          <div className="overflow-hidden">
                            <h4 className="text-xs font-medium text-neutral-100 truncate">
                              {file.name}
                            </h4>
                            <p className="text-[10px] text-neutral-500 truncate">
                              {file.path || "In-memory document"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="rounded-md bg-neutral-900 px-2 py-0.5 text-[11px] font-mono text-neutral-400">
                            {file.pageCount} {file.pageCount === 1 ? "page" : "pages"}
                          </span>

                          {/* Reorder Buttons */}
                          <div className="flex items-center gap-1 border-l border-neutral-800 pl-3">
                            <button
                              type="button"
                              onClick={() => handleMoveMergeItem(idx, "up")}
                              disabled={idx === 0}
                              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-20 cursor-pointer"
                              title="Move Up"
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveMergeItem(idx, "down")}
                              disabled={idx === queuedFiles.length - 1}
                              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-20 cursor-pointer"
                              title="Move Down"
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveMergeItem(idx)}
                              className="p-1 rounded text-neutral-400 hover:text-red-400 hover:bg-red-500/10 cursor-pointer ml-1"
                              title="Remove File"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: SPLIT PDF */}
          {/* ======================================================== */}
          {currentTab === "split" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {!activeTab ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-neutral-400">
                  <Scissors className="h-12 w-12 text-neutral-600 mb-3" />
                  <h3 className="text-sm font-semibold text-neutral-200 mb-1">
                    No Active Document
                  </h3>
                  <p className="text-xs max-w-sm mb-4">
                    Open a PDF document first in Open PDF Studio to split it into parts.
                  </p>
                  <button
                    type="button"
                    onClick={() => setCurrentTab("merge")}
                    className="rounded-lg bg-neutral-800 px-3.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 transition-colors cursor-pointer"
                  >
                    Go to Merge PDFs
                  </button>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full flex flex-col justify-between">
                  <div className="flex flex-col gap-6">
                    {/* Document Info Card */}
                    <div className="flex items-center justify-between rounded-xl bg-neutral-950 p-4 border border-neutral-800">
                      <div>
                        <h4 className="text-xs font-medium text-neutral-200">
                          {activeTab.name}
                        </h4>
                        <p className="text-[11px] text-neutral-500 mt-0.5">
                          Total document length: {activeTab.numPages} pages
                        </p>
                      </div>
                      <span className="rounded-md bg-neutral-900 border border-neutral-800 px-2.5 py-1 text-xs font-mono text-neutral-300">
                        {activeTab.numPages} Pages
                      </span>
                    </div>

                    {/* Mode Selection */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold text-neutral-300">
                        Split Mode:
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setSplitMode("ranges")}
                          className={`flex flex-col p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            splitMode === "ranges"
                              ? "border-emerald-500/80 bg-emerald-950/20 text-white"
                              : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700"
                          }`}
                        >
                          <span className="text-xs font-semibold">
                            By Page Ranges
                          </span>
                          <span className="text-[11px] text-neutral-500 mt-1">
                            Define custom intervals (e.g. 1-3, 4-6, 7)
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSplitMode("everyN")}
                          className={`flex flex-col p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            splitMode === "everyN"
                              ? "border-emerald-500/80 bg-emerald-950/20 text-white"
                              : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700"
                          }`}
                        >
                          <span className="text-xs font-semibold">
                            Every N Pages
                          </span>
                          <span className="text-[11px] text-neutral-500 mt-1">
                            Split uniformly into fixed chunk sizes
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Input based on Mode */}
                    {splitMode === "ranges" ? (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-neutral-300">
                          Page Ranges (1-based, comma-separated):
                        </label>
                        <input
                          type="text"
                          value={rangeInput}
                          onChange={(e) => setRangeInput(e.target.value)}
                          placeholder="e.g. 1-3, 4-6, 7"
                          className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3.5 py-2.5 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-emerald-500 font-mono"
                        />
                        <p className="text-[11px] text-neutral-500">
                          Examples: <code className="text-neutral-400">1-5, 6-10</code> or{" "}
                          <code className="text-neutral-400">1, 2-4, 5</code>
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-neutral-300">
                          Pages per PDF File:
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min={1}
                            max={activeTab.numPages}
                            value={everyNInput}
                            onChange={(e) =>
                              setEveryNInput(
                                Math.max(1, parseInt(e.target.value, 10) || 1)
                              )
                            }
                            className="w-28 rounded-xl bg-neutral-950 border border-neutral-800 px-3.5 py-2.5 text-xs text-neutral-100 focus:outline-none focus:border-emerald-500 font-mono"
                          />
                          <span className="text-xs text-neutral-400">
                            pages per output file
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Live Output Preview */}
                    <div className="flex flex-col gap-2 rounded-xl bg-neutral-950/60 p-4 border border-neutral-800/80">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-neutral-300">
                          Output Files Breakdown:
                        </span>
                        <span className="font-mono text-emerald-400 font-semibold">
                          {computedRanges.length} {computedRanges.length === 1 ? "file" : "files"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1 max-h-32 overflow-y-auto">
                        {computedRanges.length === 0 ? (
                          <span className="text-xs text-neutral-500 italic">
                            No valid ranges specified
                          </span>
                        ) : (
                          computedRanges.map((r, i) => (
                            <span
                              key={i}
                              className="rounded-md bg-neutral-900 border border-neutral-800 px-2.5 py-1 text-[11px] font-mono text-neutral-300"
                            >
                              Part {i + 1}: {r.label} ({r.pages.length} pgs)
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Split Action Button */}
                  <div className="pt-6 border-t border-neutral-800 flex justify-end">
                    <button
                      type="button"
                      onClick={handleExecuteSplit}
                      disabled={computedRanges.length === 0 || isProcessing}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md transition hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-40 cursor-pointer"
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FolderDown className="h-4 w-4" />
                      )}
                      <span>Select Folder & Split PDFs</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
