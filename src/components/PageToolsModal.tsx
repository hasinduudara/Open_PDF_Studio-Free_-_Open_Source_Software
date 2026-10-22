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
  Stamp,
  Hash,
  Image as ImageIcon,
  Type,
  FileText,
  Eye,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { usePdfStore, type PdfTab, type PageToolsTab } from "../store/usePdfStore";
import {
  mergePdfFiles,
  applyPageOperations,
  splitPdfByRanges,
  parsePageRanges,
  generateEveryNPageRanges,
  type PageOperation,
} from "../utils/pdfPageTools";
import {
  applyWatermarkToPdf,
  applyHeaderFooterAndPageNumbers,
  type WatermarkOptions,
  type WatermarkPosition,
  type HeaderFooterOptions,
  type PageNumberFormat,
  type PageNumberPosition,
} from "../utils/pdfStampTools";

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
  const [currentTab, setCurrentTab] = useState<PageToolsTab>(
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

  // ==========================================
  // TAB 4: WATERMARK STATE & HANDLERS
  // ==========================================
  const [wmType, setWmType] = useState<"text" | "image">("text");
  const [wmText, setWmText] = useState<string>("CONFIDENTIAL");
  const [wmFontSize, setWmFontSize] = useState<number>(48);
  const [wmColor, setWmColor] = useState<string>("#ef4444");
  const [wmOpacity, setWmOpacity] = useState<number>(0.25);
  const [wmRotation, setWmRotation] = useState<number>(-45);
  const [wmPosition, setWmPosition] = useState<WatermarkPosition>("center");
  const [wmImageScale, setWmImageScale] = useState<number>(0.5);
  const [wmPageRangeMode, setWmPageRangeMode] = useState<"all" | "custom">("all");
  const [wmCustomRange, setWmCustomRange] = useState<string>("");
  const [wmImageData, setWmImageData] = useState<Uint8Array | null>(null);
  const [wmImageName, setWmImageName] = useState<string>("");
  const [wmImagePreviewUrl, setWmImagePreviewUrl] = useState<string | null>(null);

  async function handleSelectWatermarkImage() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Image Files", extensions: ["png", "jpg", "jpeg"] }],
      });
      if (!selected) return;
      const filePath = typeof selected === "string" ? selected : selected[0];
      if (!filePath) return;
      const fileName = filePath.split(/[/\\]/).pop() || "watermark-image";
      const fileBytes = await readFile(filePath);
      setWmImageData(fileBytes);
      setWmImageName(fileName);

      const blob = new Blob([fileBytes]);
      const url = URL.createObjectURL(blob);
      setWmImagePreviewUrl(url);
    } catch (err: any) {
      console.error("Failed to load watermark image:", err);
      setErrorMessage(`Failed to load image: ${err?.message || err}`);
    }
  }

  async function handleApplyWatermark(saveAs: boolean) {
    if (!activeTab) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (wmType === "image" && !wmImageData) {
        throw new Error("Please select a PNG or JPG image file for the watermark.");
      }

      const options: WatermarkOptions = {
        type: wmType,
        text: wmType === "text" ? wmText : undefined,
        imageData: wmType === "image" && wmImageData ? wmImageData : undefined,
        imageFormat: wmImageName.toLowerCase().endsWith(".png") ? "png" : "jpg",
        fontSize: wmFontSize,
        color: wmColor,
        opacity: wmOpacity,
        rotation: wmRotation,
        position: wmPosition,
        imageScale: wmImageScale,
        pageRange: wmPageRangeMode === "custom" ? wmCustomRange : "all",
      };

      const resultBytes = await applyWatermarkToPdf(activeTab.data, options);

      if (saveAs) {
        const defaultName = activeTab.name.replace(/\.pdf$/i, "") + "_watermarked.pdf";
        const savePath = await save({
          defaultPath: defaultName,
          filters: [{ name: "PDF Files", extensions: ["pdf"] }],
        });

        if (!savePath) {
          setIsProcessing(false);
          return;
        }

        await writeFile(savePath, resultBytes);
        const savedFileName = savePath.split(/[/\\]/).pop() || defaultName;

        addTab({
          name: savedFileName,
          path: savePath,
          data: resultBytes,
        });

        setStatusMessage(`Watermarked PDF saved successfully as "${savedFileName}"!`);
      } else {
        updateTabData(activeTab.id, resultBytes);
        setStatusMessage("Watermark applied successfully to current document!");
      }
    } catch (err: any) {
      console.error("Failed to apply watermark:", err);
      setErrorMessage(`Failed to apply watermark: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  }

  // ==========================================
  // TAB 5: HEADERS, FOOTERS & PAGE NUMBERS STATE & HANDLERS
  // ==========================================
  const [hfHeaderLeft, setHfHeaderLeft] = useState<string>("");
  const [hfHeaderCenter, setHfHeaderCenter] = useState<string>("");
  const [hfHeaderRight, setHfHeaderRight] = useState<string>("");
  const [hfFooterLeft, setHfFooterLeft] = useState<string>("");
  const [hfFooterCenter, setHfFooterCenter] = useState<string>("");
  const [hfFooterRight, setHfFooterRight] = useState<string>("");

  const [hfIncludePageNumbers, setHfIncludePageNumbers] = useState<boolean>(true);
  const [hfPageNumberFormat, setHfPageNumberFormat] = useState<PageNumberFormat>("page-n-of-total");
  const [hfPageNumberPosition, setHfPageNumberPosition] = useState<PageNumberPosition>("bottom-center");
  const [hfPageNumberStartOffset, setHfPageNumberStartOffset] = useState<number>(1);
  const [hfPageNumberMargin, setHfPageNumberMargin] = useState<number>(30);
  const [hfFontSize, setHfFontSize] = useState<number>(10);
  const [hfColor, setHfColor] = useState<string>("#4b5563");
  const [hfPageRangeMode, setHfPageRangeMode] = useState<"all" | "custom">("all");
  const [hfCustomRange, setHfCustomRange] = useState<string>("");

  async function handleApplyHeaderFooter(saveAs: boolean) {
    if (!activeTab) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const options: HeaderFooterOptions = {
        headerLeft: hfHeaderLeft.trim() || undefined,
        headerCenter: hfHeaderCenter.trim() || undefined,
        headerRight: hfHeaderRight.trim() || undefined,
        footerLeft: hfFooterLeft.trim() || undefined,
        footerCenter: hfFooterCenter.trim() || undefined,
        footerRight: hfFooterRight.trim() || undefined,
        includePageNumbers: hfIncludePageNumbers,
        pageNumberFormat: hfPageNumberFormat,
        pageNumberPosition: hfPageNumberPosition,
        pageNumberStartOffset: hfPageNumberStartOffset,
        pageNumberMargin: hfPageNumberMargin,
        fontSize: hfFontSize,
        color: hfColor,
        pageRange: hfPageRangeMode === "custom" ? hfCustomRange : "all",
      };

      const resultBytes = await applyHeaderFooterAndPageNumbers(activeTab.data, options);

      if (saveAs) {
        const defaultName = activeTab.name.replace(/\.pdf$/i, "") + "_numbered.pdf";
        const savePath = await save({
          defaultPath: defaultName,
          filters: [{ name: "PDF Files", extensions: ["pdf"] }],
        });

        if (!savePath) {
          setIsProcessing(false);
          return;
        }

        await writeFile(savePath, resultBytes);
        const savedFileName = savePath.split(/[/\\]/).pop() || defaultName;

        addTab({
          name: savedFileName,
          path: savePath,
          data: resultBytes,
        });

        setStatusMessage(`Document saved with headers, footers & page numbers as "${savedFileName}"!`);
      } else {
        updateTabData(activeTab.id, resultBytes);
        setStatusMessage("Headers, footers & page numbers applied to current document!");
      }
    } catch (err: any) {
      console.error("Failed to apply headers/footers:", err);
      setErrorMessage(`Failed to apply headers and page numbers: ${err?.message || err}`);
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

            <button
              type="button"
              onClick={() => {
                setCurrentTab("watermark");
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                currentTab === "watermark"
                  ? "bg-neutral-800 text-white shadow-xs"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Stamp className="h-3.5 w-3.5 text-purple-400" />
              <span>Watermark</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCurrentTab("header-footer");
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                currentTab === "header-footer"
                  ? "bg-neutral-800 text-white shadow-xs"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Hash className="h-3.5 w-3.5 text-rose-400" />
              <span>Header & Footer</span>
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

          {/* ========================================================= */}
          {/* TAB 4: WATERMARK (TEXT & IMAGE)                           */}
          {/* ========================================================= */}
          {currentTab === "watermark" && (
            <div className="flex-1 flex flex-col p-6 overflow-hidden">
              {!activeTab ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center p-8">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800 text-neutral-400 ring-1 ring-neutral-700">
                    <Stamp className="h-7 w-7 text-purple-400" />
                  </div>
                  <h3 className="text-base font-semibold text-neutral-200">
                    No active PDF selected
                  </h3>
                  <p className="mt-1 text-xs text-neutral-400 max-w-sm">
                    Open a PDF document first to apply custom text or image watermarks.
                  </p>
                </div>
              ) : (
                <div className="flex flex-1 gap-6 overflow-hidden">
                  {/* Left Controls Column */}
                  <div className="flex-1 flex flex-col gap-5 overflow-y-auto pr-2">
                    {/* Watermark Type Selector */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold text-neutral-300">
                        Watermark Type:
                      </label>
                      <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-neutral-950 border border-neutral-800">
                        <button
                          type="button"
                          onClick={() => setWmType("text")}
                          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                            wmType === "text"
                              ? "bg-purple-600 text-white shadow-sm"
                              : "text-neutral-400 hover:text-white"
                          }`}
                        >
                          <Type className="h-3.5 w-3.5" />
                          <span>Text Watermark</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setWmType("image")}
                          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                            wmType === "image"
                              ? "bg-purple-600 text-white shadow-sm"
                              : "text-neutral-400 hover:text-white"
                          }`}
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                          <span>Image Watermark</span>
                        </button>
                      </div>
                    </div>

                    {/* Text Watermark Controls */}
                    {wmType === "text" && (
                      <div className="flex flex-col gap-4 rounded-xl bg-neutral-950/60 p-4 border border-neutral-800">
                        {/* Text Input & Quick Presets */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-neutral-300">
                            Watermark Text:
                          </label>
                          <input
                            type="text"
                            value={wmText}
                            onChange={(e) => setWmText(e.target.value)}
                            placeholder="e.g. CONFIDENTIAL, DRAFT, SAMPLE"
                            className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3.5 py-2.5 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                          />
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {["CONFIDENTIAL", "DRAFT", "SAMPLE", "COPY", "ORIGINAL", "TOP SECRET"].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setWmText(preset)}
                                className={`rounded px-2 py-0.5 text-[10px] font-mono transition cursor-pointer ${
                                  wmText === preset
                                    ? "bg-purple-600/30 text-purple-300 border border-purple-500/50"
                                    : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                                }`}
                              >
                                {preset}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Font Size & Color */}
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-neutral-800/80">
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="text-neutral-300 font-medium">Font Size:</span>
                              <span className="font-mono text-purple-400">{wmFontSize} pt</span>
                            </div>
                            <input
                              type="range"
                              min={14}
                              max={120}
                              value={wmFontSize}
                              onChange={(e) => setWmFontSize(parseInt(e.target.value, 10))}
                              className="w-full accent-purple-500 cursor-pointer"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <span className="text-xs text-neutral-300 font-medium block">Color:</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={wmColor}
                                onChange={(e) => setWmColor(e.target.value)}
                                className="h-7 w-8 rounded cursor-pointer bg-transparent border-0"
                              />
                              <div className="flex items-center gap-1">
                                {["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#6b7280", "#000000"].map((c) => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => setWmColor(c)}
                                    style={{ backgroundColor: c }}
                                    className={`h-5 w-5 rounded-full border cursor-pointer transition ${
                                      wmColor.toLowerCase() === c.toLowerCase()
                                        ? "border-white ring-1 ring-purple-400 scale-110"
                                        : "border-neutral-700 hover:scale-105"
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Image Watermark Controls */}
                    {wmType === "image" && (
                      <div className="flex flex-col gap-4 rounded-xl bg-neutral-950/60 p-4 border border-neutral-800">
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-neutral-300">
                            Select Watermark Image:
                          </label>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={handleSelectWatermarkImage}
                              className="inline-flex items-center gap-2 rounded-lg bg-neutral-800 border border-neutral-700 px-3.5 py-2 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 hover:text-white cursor-pointer"
                            >
                              <FolderOpen className="h-4 w-4 text-purple-400" />
                              <span>{wmImageData ? "Change Image..." : "Choose PNG/JPG..."}</span>
                            </button>
                            {wmImageName && (
                              <span className="text-xs text-neutral-300 font-mono truncate max-w-xs">
                                {wmImageName}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Image Scale Slider */}
                        <div className="space-y-1.5 pt-2 border-t border-neutral-800/80">
                          <div className="flex justify-between text-xs">
                            <span className="text-neutral-300 font-medium">Image Scale:</span>
                            <span className="font-mono text-purple-400">{Math.round(wmImageScale * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0.1}
                            max={1.5}
                            step={0.05}
                            value={wmImageScale}
                            onChange={(e) => setWmImageScale(parseFloat(e.target.value))}
                            className="w-full accent-purple-500 cursor-pointer"
                          />
                        </div>
                      </div>
                    )}

                    {/* Common Position, Angle & Opacity */}
                    <div className="flex flex-col gap-4 rounded-xl bg-neutral-950/60 p-4 border border-neutral-800">
                      {/* Position Grid */}
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-neutral-300">
                          Watermark Position:
                        </label>
                        <div className="grid grid-cols-3 gap-1.5 text-xs">
                          {[
                            { pos: "center", label: "Center" },
                            { pos: "top-left", label: "Top-Left" },
                            { pos: "top-right", label: "Top-Right" },
                            { pos: "bottom-left", label: "Bottom-Left" },
                            { pos: "bottom-right", label: "Bottom-Right" },
                            { pos: "tile", label: "Tile Pattern" },
                          ].map((item) => (
                            <button
                              key={item.pos}
                              type="button"
                              onClick={() => setWmPosition(item.pos as WatermarkPosition)}
                              className={`rounded-lg py-1.5 px-2 text-[11px] font-medium transition cursor-pointer ${
                                wmPosition === item.pos
                                  ? "bg-purple-600 text-white shadow-xs"
                                  : "bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white"
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Rotation Angle */}
                      <div className="space-y-2 pt-2 border-t border-neutral-800/80">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-300 font-medium">Rotation Angle:</span>
                          <span className="font-mono text-purple-400">{wmRotation}°</span>
                        </div>
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={5}
                          value={wmRotation}
                          onChange={(e) => setWmRotation(parseInt(e.target.value, 10))}
                          className="w-full accent-purple-500 cursor-pointer"
                        />
                        <div className="flex gap-1.5 pt-1">
                          {[-45, 0, 45, 90].map((deg) => (
                            <button
                              key={deg}
                              type="button"
                              onClick={() => setWmRotation(deg)}
                              className={`rounded px-2 py-0.5 text-[10px] font-mono transition cursor-pointer ${
                                wmRotation === deg
                                  ? "bg-purple-600/30 text-purple-300 border border-purple-500/50"
                                  : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                              }`}
                            >
                              {deg}° {deg === -45 ? "(Diagonal)" : deg === 0 ? "(Flat)" : ""}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Opacity Slider */}
                      <div className="space-y-1.5 pt-2 border-t border-neutral-800/80">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-300 font-medium">Opacity / Transparency:</span>
                          <span className="font-mono text-purple-400">{Math.round(wmOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.05}
                          max={1.0}
                          step={0.05}
                          value={wmOpacity}
                          onChange={(e) => setWmOpacity(parseFloat(e.target.value))}
                          className="w-full accent-purple-500 cursor-pointer"
                        />
                      </div>

                      {/* Page Range Targeting */}
                      <div className="space-y-2 pt-2 border-t border-neutral-800/80">
                        <label className="text-xs font-semibold text-neutral-300">
                          Target Pages:
                        </label>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                            <input
                              type="radio"
                              name="wmPageRange"
                              checked={wmPageRangeMode === "all"}
                              onChange={() => setWmPageRangeMode("all")}
                              className="accent-purple-500"
                            />
                            <span>All Pages ({activeTab.numPages})</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                            <input
                              type="radio"
                              name="wmPageRange"
                              checked={wmPageRangeMode === "custom"}
                              onChange={() => setWmPageRangeMode("custom")}
                              className="accent-purple-500"
                            />
                            <span>Custom Range</span>
                          </label>
                        </div>
                        {wmPageRangeMode === "custom" && (
                          <input
                            type="text"
                            value={wmCustomRange}
                            onChange={(e) => setWmCustomRange(e.target.value)}
                            placeholder="e.g. 1-3, 5, 7"
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 font-mono focus:outline-none focus:border-purple-500"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Live Visual Preview Card & Actions */}
                  <div className="w-80 flex flex-col gap-4 flex-shrink-0">
                    <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
                      <Eye className="h-4 w-4 text-purple-400" />
                      <span>Live Preview</span>
                    </div>

                    {/* Paper Preview Sheet */}
                    <div className="relative w-full aspect-[1/1.35] bg-white rounded-lg shadow-xl overflow-hidden flex items-center justify-center border border-neutral-300 select-none">
                      {/* Simulated text lines */}
                      <div className="absolute inset-5 space-y-2 opacity-15 pointer-events-none">
                        <div className="h-2.5 bg-neutral-800 rounded w-1/3 mb-4" />
                        <div className="h-1.5 bg-neutral-700 rounded w-full" />
                        <div className="h-1.5 bg-neutral-700 rounded w-5/6" />
                        <div className="h-1.5 bg-neutral-700 rounded w-full" />
                        <div className="h-1.5 bg-neutral-700 rounded w-4/6" />
                        <div className="h-1.5 bg-neutral-700 rounded w-full" />
                        <div className="h-1.5 bg-neutral-700 rounded w-3/4" />
                        <div className="h-1.5 bg-neutral-700 rounded w-full mt-4" />
                        <div className="h-1.5 bg-neutral-700 rounded w-5/6" />
                        <div className="h-1.5 bg-neutral-700 rounded w-full" />
                        <div className="h-1.5 bg-neutral-700 rounded w-2/3" />
                      </div>

                      {/* Watermark Rendering */}
                      {wmPosition === "tile" ? (
                        <div className="absolute inset-0 grid grid-cols-2 grid-rows-3 p-4 pointer-events-none">
                          {[0, 1, 2, 3, 4, 5].map((tileIdx) => (
                            <div key={tileIdx} className="flex items-center justify-center">
                              {wmType === "text" ? (
                                <span
                                  style={{
                                    transform: `rotate(${wmRotation}deg)`,
                                    color: wmColor,
                                    opacity: wmOpacity,
                                    fontSize: `${Math.max(8, wmFontSize * 0.28)}px`,
                                  }}
                                  className="font-bold tracking-wider select-none font-sans whitespace-nowrap"
                                >
                                  {wmText || "CONFIDENTIAL"}
                                </span>
                              ) : wmImagePreviewUrl ? (
                                <img
                                  src={wmImagePreviewUrl}
                                  alt="watermark-tile"
                                  style={{
                                    transform: `rotate(${wmRotation}deg)`,
                                    opacity: wmOpacity,
                                    width: `${Math.max(20, 60 * wmImageScale * 0.5)}px`,
                                  }}
                                  className="object-contain"
                                />
                              ) : (
                                <Stamp
                                  style={{
                                    transform: `rotate(${wmRotation}deg)`,
                                    opacity: wmOpacity,
                                  }}
                                  className="h-8 w-8 text-neutral-400"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          className={`absolute inset-0 flex pointer-events-none p-6 ${
                            wmPosition === "top-left"
                              ? "items-start justify-start"
                              : wmPosition === "top-right"
                              ? "items-start justify-end"
                              : wmPosition === "bottom-left"
                              ? "items-end justify-start"
                              : wmPosition === "bottom-right"
                              ? "items-end justify-end"
                              : "items-center justify-center"
                          }`}
                        >
                          {wmType === "text" ? (
                            <span
                              style={{
                                transform: `rotate(${wmRotation}deg)`,
                                color: wmColor,
                                opacity: wmOpacity,
                                fontSize: `${Math.max(10, wmFontSize * 0.38)}px`,
                              }}
                              className="font-bold tracking-wider select-none font-sans whitespace-nowrap"
                            >
                              {wmText || "CONFIDENTIAL"}
                            </span>
                          ) : wmImagePreviewUrl ? (
                            <img
                              src={wmImagePreviewUrl}
                              alt="watermark-preview"
                              style={{
                                transform: `rotate(${wmRotation}deg)`,
                                opacity: wmOpacity,
                                width: `${Math.max(30, 140 * wmImageScale)}px`,
                              }}
                              className="object-contain"
                            />
                          ) : (
                            <Stamp
                              style={{
                                transform: `rotate(${wmRotation}deg)`,
                                opacity: wmOpacity,
                              }}
                              className="h-14 w-14 text-neutral-400"
                            />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => handleApplyWatermark(false)}
                        disabled={isProcessing}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md transition hover:bg-purple-500 active:bg-purple-700 disabled:opacity-40 cursor-pointer"
                      >
                        {isProcessing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        <span>Apply to Current PDF</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleApplyWatermark(true)}
                        disabled={isProcessing}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-800 border border-neutral-700 px-4 py-2.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 hover:text-white active:bg-neutral-850 disabled:opacity-40 cursor-pointer"
                      >
                        <Save className="h-4 w-4" />
                        <span>Save As New File...</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 5: HEADERS, FOOTERS & PAGE NUMBERS                    */}
          {/* ========================================================= */}
          {currentTab === "header-footer" && (
            <div className="flex-1 flex flex-col p-6 overflow-hidden">
              {!activeTab ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center p-8">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800 text-neutral-400 ring-1 ring-neutral-700">
                    <Hash className="h-7 w-7 text-rose-400" />
                  </div>
                  <h3 className="text-base font-semibold text-neutral-200">
                    No active PDF selected
                  </h3>
                  <p className="mt-1 text-xs text-neutral-400 max-w-sm">
                    Open a PDF document first to configure headers, footers, and page numbers.
                  </p>
                </div>
              ) : (
                <div className="flex flex-1 gap-6 overflow-hidden">
                  {/* Left Controls Column */}
                  <div className="flex-1 flex flex-col gap-5 overflow-y-auto pr-2">
                    {/* Header Inputs Section */}
                    <div className="flex flex-col gap-3 rounded-xl bg-neutral-950/60 p-4 border border-neutral-800">
                      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
                        <FileText className="h-4 w-4 text-rose-400" />
                        <span>Header Slots (Top Margin)</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <span className="text-[11px] text-neutral-400">Left Header:</span>
                          <input
                            type="text"
                            value={hfHeaderLeft}
                            onChange={(e) => setHfHeaderLeft(e.target.value)}
                            placeholder="e.g. Document Title"
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-rose-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[11px] text-neutral-400">Center Header:</span>
                          <input
                            type="text"
                            value={hfHeaderCenter}
                            onChange={(e) => setHfHeaderCenter(e.target.value)}
                            placeholder="e.g. Chapter / Section"
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-rose-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[11px] text-neutral-400">Right Header:</span>
                          <input
                            type="text"
                            value={hfHeaderRight}
                            onChange={(e) => setHfHeaderRight(e.target.value)}
                            placeholder="e.g. Date / Department"
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-rose-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Footer Inputs Section */}
                    <div className="flex flex-col gap-3 rounded-xl bg-neutral-950/60 p-4 border border-neutral-800">
                      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
                        <FileText className="h-4 w-4 text-blue-400" />
                        <span>Footer Slots (Bottom Margin)</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <span className="text-[11px] text-neutral-400">Left Footer:</span>
                          <input
                            type="text"
                            value={hfFooterLeft}
                            onChange={(e) => setHfFooterLeft(e.target.value)}
                            placeholder="e.g. Confidential"
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-rose-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[11px] text-neutral-400">Center Footer:</span>
                          <input
                            type="text"
                            value={hfFooterCenter}
                            onChange={(e) => setHfFooterCenter(e.target.value)}
                            placeholder="e.g. All Rights Reserved"
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-rose-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[11px] text-neutral-400">Right Footer:</span>
                          <input
                            type="text"
                            value={hfFooterRight}
                            onChange={(e) => setHfFooterRight(e.target.value)}
                            placeholder="e.g. Author Name"
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-rose-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Dynamic Page Numbers Section */}
                    <div className="flex flex-col gap-4 rounded-xl bg-neutral-950/60 p-4 border border-neutral-800">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs font-semibold text-neutral-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hfIncludePageNumbers}
                            onChange={(e) => setHfIncludePageNumbers(e.target.checked)}
                            className="rounded accent-rose-500 h-4 w-4"
                          />
                          <span>Add Automatic Page Numbers</span>
                        </label>
                      </div>

                      {hfIncludePageNumbers && (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-neutral-800/80">
                          <div className="space-y-1">
                            <span className="text-[11px] text-neutral-400">Format:</span>
                            <select
                              value={hfPageNumberFormat}
                              onChange={(e) => setHfPageNumberFormat(e.target.value as PageNumberFormat)}
                              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-rose-500"
                            >
                              <option value="page-n-of-total">Page 1 of {activeTab.numPages}</option>
                              <option value="page-n">Page 1</option>
                              <option value="number">1</option>
                              <option value="dash-n-dash">- 1 -</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[11px] text-neutral-400">Position:</span>
                            <select
                              value={hfPageNumberPosition}
                              onChange={(e) => setHfPageNumberPosition(e.target.value as PageNumberPosition)}
                              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-rose-500"
                            >
                              <option value="bottom-center">Bottom Center</option>
                              <option value="bottom-right">Bottom Right</option>
                              <option value="bottom-left">Bottom Left</option>
                              <option value="top-right">Top Right</option>
                              <option value="top-center">Top Center</option>
                              <option value="top-left">Top Left</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[11px] text-neutral-400">Start Numbering At:</span>
                            <input
                              type="number"
                              min={1}
                              value={hfPageNumberStartOffset}
                              onChange={(e) => setHfPageNumberStartOffset(Math.max(1, parseInt(e.target.value, 10) || 1))}
                              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 font-mono focus:outline-none focus:border-rose-500"
                            />
                          </div>

                          <div className="space-y-1">
                            <span className="text-[11px] text-neutral-400">Margin Offset (pt):</span>
                            <input
                              type="number"
                              min={10}
                              max={100}
                              value={hfPageNumberMargin}
                              onChange={(e) => setHfPageNumberMargin(Math.max(10, parseInt(e.target.value, 10) || 30))}
                              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 font-mono focus:outline-none focus:border-rose-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Styling & Target Pages */}
                    <div className="flex flex-col gap-4 rounded-xl bg-neutral-950/60 p-4 border border-neutral-800">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-neutral-300 font-medium">Font Size:</span>
                            <span className="font-mono text-rose-400">{hfFontSize} pt</span>
                          </div>
                          <input
                            type="range"
                            min={8}
                            max={20}
                            value={hfFontSize}
                            onChange={(e) => setHfFontSize(parseInt(e.target.value, 10))}
                            className="w-full accent-rose-500 cursor-pointer"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <span className="text-xs text-neutral-300 font-medium block">Color:</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={hfColor}
                              onChange={(e) => setHfColor(e.target.value)}
                              className="h-7 w-8 rounded cursor-pointer bg-transparent border-0"
                            />
                            <div className="flex items-center gap-1">
                              {["#4b5563", "#1f2937", "#ef4444", "#3b82f6", "#10b981", "#000000"].map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => setHfColor(c)}
                                  style={{ backgroundColor: c }}
                                  className={`h-5 w-5 rounded-full border cursor-pointer transition ${
                                    hfColor.toLowerCase() === c.toLowerCase()
                                      ? "border-white ring-1 ring-rose-400 scale-110"
                                      : "border-neutral-700 hover:scale-105"
                                  }`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Page Range Targeting */}
                      <div className="space-y-2 pt-2 border-t border-neutral-800/80">
                        <label className="text-xs font-semibold text-neutral-300">
                          Target Pages:
                        </label>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                            <input
                              type="radio"
                              name="hfPageRange"
                              checked={hfPageRangeMode === "all"}
                              onChange={() => setHfPageRangeMode("all")}
                              className="accent-rose-500"
                            />
                            <span>All Pages ({activeTab.numPages})</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                            <input
                              type="radio"
                              name="hfPageRange"
                              checked={hfPageRangeMode === "custom"}
                              onChange={() => setHfPageRangeMode("custom")}
                              className="accent-rose-500"
                            />
                            <span>Custom Range (e.g. skip title page)</span>
                          </label>
                        </div>
                        {hfPageRangeMode === "custom" && (
                          <input
                            type="text"
                            value={hfCustomRange}
                            onChange={(e) => setHfCustomRange(e.target.value)}
                            placeholder="e.g. 2-10"
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 font-mono focus:outline-none focus:border-rose-500"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Live Visual Preview Card & Actions */}
                  <div className="w-80 flex flex-col gap-4 flex-shrink-0">
                    <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
                      <Eye className="h-4 w-4 text-rose-400" />
                      <span>Live Preview</span>
                    </div>

                    {/* Paper Preview Sheet */}
                    <div className="relative w-full aspect-[1/1.35] bg-white rounded-lg shadow-xl overflow-hidden flex flex-col justify-between p-4 border border-neutral-300 select-none">
                      {/* Top Header Preview */}
                      <div
                        style={{ color: hfColor, fontSize: `${Math.max(7, hfFontSize * 0.75)}px` }}
                        className="flex items-center justify-between border-b border-neutral-200 pb-1 font-sans font-medium"
                      >
                        <span className="truncate max-w-[30%]">
                          {hfPageNumberPosition === "top-left" && hfIncludePageNumbers
                            ? `Page 1`
                            : hfHeaderLeft}
                        </span>
                        <span className="truncate max-w-[40%] text-center">
                          {hfPageNumberPosition === "top-center" && hfIncludePageNumbers
                            ? `Page 1`
                            : hfHeaderCenter}
                        </span>
                        <span className="truncate max-w-[30%] text-right">
                          {hfPageNumberPosition === "top-right" && hfIncludePageNumbers
                            ? `Page 1 of ${activeTab.numPages}`
                            : hfHeaderRight}
                        </span>
                      </div>

                      {/* Simulated text lines */}
                      <div className="space-y-2 opacity-15 pointer-events-none my-auto">
                        <div className="h-2.5 bg-neutral-800 rounded w-1/3 mb-4" />
                        <div className="h-1.5 bg-neutral-700 rounded w-full" />
                        <div className="h-1.5 bg-neutral-700 rounded w-5/6" />
                        <div className="h-1.5 bg-neutral-700 rounded w-full" />
                        <div className="h-1.5 bg-neutral-700 rounded w-4/6" />
                        <div className="h-1.5 bg-neutral-700 rounded w-full" />
                        <div className="h-1.5 bg-neutral-700 rounded w-3/4" />
                        <div className="h-1.5 bg-neutral-700 rounded w-full mt-4" />
                        <div className="h-1.5 bg-neutral-700 rounded w-5/6" />
                        <div className="h-1.5 bg-neutral-700 rounded w-full" />
                      </div>

                      {/* Bottom Footer Preview */}
                      <div
                        style={{ color: hfColor, fontSize: `${Math.max(7, hfFontSize * 0.75)}px` }}
                        className="flex items-center justify-between border-t border-neutral-200 pt-1 font-sans font-medium"
                      >
                        <span className="truncate max-w-[30%]">
                          {hfPageNumberPosition === "bottom-left" && hfIncludePageNumbers
                            ? `Page 1`
                            : hfFooterLeft}
                        </span>
                        <span className="truncate max-w-[40%] text-center">
                          {hfPageNumberPosition === "bottom-center" && hfIncludePageNumbers
                            ? hfPageNumberFormat === "page-n-of-total"
                              ? `Page 1 of ${activeTab.numPages}`
                              : hfPageNumberFormat === "page-n"
                              ? `Page 1`
                              : hfPageNumberFormat === "dash-n-dash"
                              ? `- 1 -`
                              : `1`
                            : hfFooterCenter}
                        </span>
                        <span className="truncate max-w-[30%] text-right">
                          {hfPageNumberPosition === "bottom-right" && hfIncludePageNumbers
                            ? `Page 1 of ${activeTab.numPages}`
                            : hfFooterRight}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => handleApplyHeaderFooter(false)}
                        disabled={isProcessing}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md transition hover:bg-rose-500 active:bg-rose-700 disabled:opacity-40 cursor-pointer"
                      >
                        {isProcessing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        <span>Apply to Current PDF</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleApplyHeaderFooter(true)}
                        disabled={isProcessing}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-800 border border-neutral-700 px-4 py-2.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 hover:text-white active:bg-neutral-850 disabled:opacity-40 cursor-pointer"
                      >
                        <Save className="h-4 w-4" />
                        <span>Save As New File...</span>
                      </button>
                    </div>
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
