import { useState, useEffect } from "react";
import {
  FolderOpen,
  FileText,
  ShieldCheck,
  Zap,
  Layers,
  UploadCloud,
  Clock,
  Trash2,
  X,
  FileArchive,
  RefreshCw,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePdfStore, type RecentFile } from "./store/usePdfStore";
import { saveAnnotatedPdf } from "./utils/pdfSaver";
import { checkForAppUpdates } from "./utils/updateManager";
import Toolbar from "./components/Toolbar";
import TabBar from "./components/TabBar";
import Sidebar from "./components/Sidebar";
import PdfViewer from "./components/PdfViewer";
import PageToolsModal from "./components/PageToolsModal";
import SignatureModal from "./components/SignatureModal";
import UpdateModal from "./components/UpdateModal";
import "./App.css";

/**
 * Formats a timestamp into a human-readable relative time string.
 */
function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Main application container for Open PDF Studio.
 * Handles drag-and-drop file ingestion, global keyboard shortcuts,
 * recent files list, multi-tab layout, and collapsible sidebar.
 */
export default function App() {
  const {
    tabs,
    activeTabId,
    addTab,
    closeTab,
    setScale,
    openSearch,
    recentFiles,
    clearRecentFiles,
    removeRecentFile,
    undoLastAnnotation,
    setActiveTool,
    openPageTools,
  } = usePdfStore();

  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [appVersion, setAppVersion] = useState<string>("");

  /**
   * Reads a PDF file path from disk and opens it in an active tab.
   * If the file is already open, focuses its tab.
   */
  async function openPdfFromPath(filePath: string) {
    if (!filePath) return;
    const cleanPath = filePath.replace(/^["']|["']$/g, "").trim();
    if (!cleanPath.toLowerCase().endsWith(".pdf")) return;

    // If file is already open in a tab, switch to that tab
    const existingTab = usePdfStore
      .getState()
      .tabs.find((t) => t.path.toLowerCase() === cleanPath.toLowerCase());
    if (existingTab) {
      usePdfStore.setState({ activeTabId: existingTab.id });
      return;
    }

    try {
      const fileName = cleanPath.split(/[/\\]/).pop() || "Document.pdf";
      const fileData = await readFile(cleanPath);

      addTab({
        name: fileName,
        path: cleanPath,
        data: fileData,
      });
    } catch (err) {
      console.error(`Failed to open PDF from path ${cleanPath}:`, err);
    }
  }

  /**
   * Prompts user to select and open a PDF document from disk.
   */
  async function handleOpenPdf() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF Files", extensions: ["pdf"] }],
      });

      if (!selected) return;

      const filePath = typeof selected === "string" ? selected : selected[0];
      if (!filePath) return;

      await openPdfFromPath(filePath);
    } catch (error) {
      console.error("Failed to open PDF file:", error);
    }
  }

  /**
   * Opens a file directly from the recent files list.
   */
  async function handleOpenRecent(file: RecentFile) {
    await openPdfFromPath(file.path);
  }

  // Register Global Keyboard Shortcuts (Ctrl+O, Ctrl+F, Ctrl+W, Zoom)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+O: Open PDF file dialog
      if (isCtrl && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpenPdf();
        return;
      }

      // Ctrl+F: Open & focus search bar
      if (isCtrl && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
        return;
      }

      // Ctrl+S: Save annotated PDF to disk
      if (isCtrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const activeTab = tabs.find((t) => t.id === activeTabId);
        if (activeTab) {
          saveAnnotatedPdf(activeTab);
        }
        return;
      }

      // Ctrl+Z: Undo last annotation (unless focused in a text editing element)
      if (isCtrl && e.key.toLowerCase() === "z" && !e.shiftKey) {
        const isEditingText =
          document.activeElement?.tagName === "INPUT" ||
          document.activeElement?.tagName === "TEXTAREA";
        if (!isEditingText) {
          e.preventDefault();
          undoLastAnnotation(activeTabId || undefined);
          return;
        }
      }

      // Ctrl+W: Close active tab
      if (isCtrl && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
        return;
      }

      // Zoom Shortcuts: Ctrl+=, Ctrl+-, Ctrl+0
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (activeTab) {
        if (isCtrl && (e.key === "=" || e.key === "+")) {
          e.preventDefault();
          setScale(activeTab.id, Math.round((activeTab.scale + 0.15) * 100) / 100);
          return;
        }
        if (isCtrl && (e.key === "-" || e.key === "_")) {
          e.preventDefault();
          setScale(activeTab.id, Math.round((activeTab.scale - 0.15) * 100) / 100);
          return;
        }
        if (isCtrl && e.key === "0") {
          e.preventDefault();
          setScale(activeTab.id, 1.0);
          return;
        }
      }

      // Quick tool switching shortcuts: V, H, N, P (only when not editing text)
      if (!isCtrl && !e.altKey && !e.shiftKey) {
        const isEditingText =
          document.activeElement?.tagName === "INPUT" ||
          document.activeElement?.tagName === "TEXTAREA";
        if (!isEditingText) {
          const key = e.key.toLowerCase();
          if (key === "v") {
            setActiveTool("select");
          } else if (key === "h") {
            setActiveTool("highlight");
          } else if (key === "n") {
            setActiveTool("note");
          } else if (key === "p" || key === "d") {
            setActiveTool("draw");
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTabId, tabs, setScale, closeTab, openSearch, undoLastAnnotation, setActiveTool]);

  // Check for updates silently in the background 3-5 seconds after launch
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForAppUpdates(false);
    }, 4000);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Fetch actual application version dynamically from Tauri
  useEffect(() => {
    let isSubscribed = true;

    async function fetchAppVersion() {
      try {
        const ver = await getVersion();
        if (isSubscribed && ver) {
          setAppVersion(ver);
        }
      } catch (err) {
        console.warn("Failed to fetch application version:", err);
      }
    }

    fetchAppVersion();

    return () => {
      isSubscribed = false;
    };
  }, []);

  // Read launch arguments on startup and listen for OS file association open events
  useEffect(() => {
    let isSubscribed = true;

    async function handleLaunchArguments() {
      try {
        const args = await invoke<string[]>("get_cli_args");
        if (!isSubscribed || !Array.isArray(args)) return;

        // Find the first argument that ends with .pdf (case-insensitive)
        const pdfArg = args.find((arg) => {
          const clean = arg.replace(/^["']|["']$/g, "").trim();
          return clean.toLowerCase().endsWith(".pdf");
        });

        if (pdfArg) {
          const cleanPath = pdfArg.replace(/^["']|["']$/g, "").trim();
          const fileName = cleanPath.split(/[/\\]/).pop() || "Document.pdf";
          const fileData = await readFile(cleanPath);
          if (isSubscribed) {
            addTab({
              name: fileName,
              path: cleanPath,
              data: fileData,
            });
          }
        }
      } catch (err) {
        console.warn("Failed to read startup launch arguments:", err);
      }
    }

    handleLaunchArguments();

    // Listen for single-instance launch events when double-clicking a PDF while app is already running
    let unlistenFn: (() => void) | undefined;
    async function initSingleInstanceListener() {
      try {
        unlistenFn = await listen<{ args: string[]; cwd: string }>(
          "single-instance",
          async (event) => {
            const args = event.payload?.args || [];
            const pdfArg = args.find((arg) => {
              const clean = arg.replace(/^["']|["']$/g, "").trim();
              return clean.toLowerCase().endsWith(".pdf");
            });
            if (pdfArg) {
              const cleanPath = pdfArg.replace(/^["']|["']$/g, "").trim();
              const fileName = cleanPath.split(/[/\\]/).pop() || "Document.pdf";
              const fileData = await readFile(cleanPath);
              addTab({
                name: fileName,
                path: cleanPath,
                data: fileData,
              });
            }
          }
        );
      } catch (err) {
        console.warn("Failed to register single-instance listener:", err);
      }
    }

    initSingleInstanceListener();

    return () => {
      isSubscribed = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [addTab]);

  // Set up Tauri native window drag-and-drop listener
  useEffect(() => {
    let isSubscribed = true;
    let unlistenFn: (() => void) | undefined;

    async function initTauriDragDrop() {
      try {
        const webview = getCurrentWebview();
        unlistenFn = await webview.onDragDropEvent(async (event) => {
          if (!isSubscribed) return;

          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDragOver(true);
          } else if (event.payload.type === "leave") {
            setIsDragOver(false);
          } else if (event.payload.type === "drop") {
            setIsDragOver(false);
            const droppedPaths = event.payload.paths;

            for (const filePath of droppedPaths) {
              if (filePath.toLowerCase().endsWith(".pdf")) {
                try {
                  const fileName = filePath.split(/[/\\]/).pop() || "Document.pdf";
                  const fileData = await readFile(filePath);
                  addTab({
                    name: fileName,
                    path: filePath,
                    data: fileData,
                  });
                } catch (readErr) {
                  console.error(`Failed to read dropped file ${filePath}:`, readErr);
                }
              }
            }
          }
        });
      } catch (err) {
        console.warn("Native Tauri drag-drop handler not registered:", err);
      }
    }

    initTauriDragDrop();

    return () => {
      isSubscribed = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [addTab]);

  /**
   * Fallback HTML5 drop handler for web preview and desktop events
   */
  async function handleHtmlDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file.name.toLowerCase().endsWith(".pdf")) {
          try {
            const buffer = await file.arrayBuffer();
            const filePath = (file as unknown as { path?: string }).path || file.name;
            addTab({
              name: file.name,
              path: filePath,
              data: new Uint8Array(buffer),
            });
          } catch (err) {
            console.error("Failed to parse dropped HTML file:", err);
          }
        }
      }
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
      }}
      onDrop={handleHtmlDrop}
      className="relative flex h-screen w-screen flex-col bg-neutral-950 text-neutral-100 select-none overflow-hidden"
    >
      {/* Full-screen drag overlay indicator */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-neutral-950/80 backdrop-blur-sm border-2 border-dashed border-red-500 m-2 rounded-xl pointer-events-none transition-all">
          <UploadCloud className="h-16 w-16 text-red-500 animate-bounce mb-3" />
          <h3 className="text-xl font-bold text-white tracking-wide">
            Drop PDF to open
          </h3>
          <p className="text-sm text-neutral-400 mt-1">
            Release your files to view them in Open PDF Studio
          </p>
        </div>
      )}

      {tabs.length > 0 ? (
        <>
          {/* Active Tabs Navigation */}
          <TabBar />

          {/* Navigation and Viewing Toolbar */}
          <Toolbar />

          {/* Main Content Area (Sidebar + PDF Viewer) */}
          <div className="flex flex-1 overflow-hidden relative">
            <Sidebar />
            <PdfViewer />
          </div>
        </>
      ) : (
        <>
          {/* Top Application Header Bar */}
          <header className="flex h-14 items-center justify-between border-b border-neutral-800 bg-neutral-900/80 px-4 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/10 p-1 ring-1 ring-red-500/20">
                <img src="/icon.svg" alt="Open PDF Studio" className="h-6 w-6 object-contain" />
              </div>
              <div className="flex items-baseline gap-2">
                <h1 className="text-sm font-semibold tracking-tight text-neutral-100">
                  Open PDF Studio
                </h1>
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
                  {appVersion ? `v${appVersion}` : "v..."}
                </span>
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => checkForAppUpdates(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/80 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-700 hover:text-white active:bg-neutral-800 cursor-pointer"
                title="Check for software updates"
              >
                <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
                <span>Check Updates</span>
              </button>
              <button
                type="button"
                onClick={() => openPageTools("convert")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/80 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-700 hover:text-white active:bg-neutral-800 cursor-pointer"
                title="Convert Images to PDF (Image to PDF)"
              >
                <FileArchive className="h-4 w-4 text-cyan-400" />
                <span>Image to PDF</span>
              </button>
              <button
                type="button"
                onClick={() => openPageTools("merge")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/80 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-700 hover:text-white active:bg-neutral-800 cursor-pointer"
                title="Combine multiple PDF documents into one (Merge PDFs)"
              >
                <Layers className="h-4 w-4 text-blue-400" />
                <span>Merge PDFs</span>
              </button>
              <button
                type="button"
                onClick={handleOpenPdf}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-red-500 active:bg-red-700 cursor-pointer"
              >
                <FolderOpen className="h-4 w-4" />
                <span>Open PDF</span>
              </button>
            </div>
          </header>

          {/* Main Workspace / Empty State */}
          <main className="flex flex-1 overflow-y-auto p-6 items-center justify-center">
            <div className="flex w-full max-w-xl flex-col items-center gap-6 my-auto">
              {/* Drop / Browse Prompt Card */}
              <div className="w-full flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-800 bg-neutral-900/30 hover:border-neutral-700 hover:bg-neutral-900/50 p-8 text-center transition-all duration-200">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800/80 text-neutral-400 ring-1 ring-neutral-700/50">
                  <FolderOpen className="h-7 w-7 text-neutral-300" />
                </div>

                <h2 className="text-lg font-semibold text-neutral-100">
                  No document loaded
                </h2>
                <p className="mt-1 text-xs text-neutral-400">
                  Open a PDF file or drag & drop documents here to begin.
                </p>

                {/* Action Trigger */}
                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleOpenPdf}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-500 active:bg-red-700 cursor-pointer"
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span>Browse Files</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openPageTools("merge")}
                    className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700 hover:text-white active:bg-neutral-850 cursor-pointer"
                  >
                    <Layers className="h-4 w-4 text-blue-400" />
                    <span>Merge PDFs</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openPageTools("convert")}
                    className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700 hover:text-white active:bg-neutral-850 cursor-pointer"
                    title="Convert images into a PDF document"
                  >
                    <FileArchive className="h-4 w-4 text-cyan-400" />
                    <span>Image to PDF</span>
                  </button>
                </div>

                {/* Highlights */}
                <div className="mt-6 grid grid-cols-3 gap-3 border-t border-neutral-800/80 pt-5 text-left w-full">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                      <Zap className="h-3.5 w-3.5 text-amber-400" />
                      <span>Fast</span>
                    </div>
                    <p className="text-[11px] text-neutral-500">
                      Hardware-accelerated rendering.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Private</span>
                    </div>
                    <p className="text-[11px] text-neutral-500">
                      100% local, zero tracking.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                      <Layers className="h-3.5 w-3.5 text-blue-400" />
                      <span>Open Source</span>
                    </div>
                    <p className="text-[11px] text-neutral-500">
                      Licensed under GNU GPLv3.
                    </p>
                  </div>
                </div>
              </div>

              {/* Recent Files List */}
              {recentFiles.length > 0 && (
                <div className="w-full rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                  <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                    <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
                      <Clock className="h-3.5 w-3.5 text-neutral-400" />
                      <span>Recent Documents</span>
                    </div>
                    <button
                      type="button"
                      onClick={clearRecentFiles}
                      className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
                      title="Clear all recent documents"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Clear</span>
                    </button>
                  </div>

                  <div className="mt-2 divide-y divide-neutral-800/50">
                    {recentFiles.map((file) => (
                      <div
                        key={file.path}
                        onClick={() => handleOpenRecent(file)}
                        className="group flex items-center justify-between py-2 px-2 rounded-lg cursor-pointer hover:bg-neutral-800/60 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-3">
                          <FileText className="h-4 w-4 flex-shrink-0 text-red-400 group-hover:text-red-300" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-medium text-neutral-200 truncate group-hover:text-white">
                              {file.name}
                            </span>
                            <span className="text-[11px] text-neutral-500 truncate" title={file.path}>
                              {file.path}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] text-neutral-500 font-mono">
                            {formatRelativeTime(file.lastOpened)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRecentFile(file.path);
                            }}
                            className="rounded p-1 text-neutral-600 hover:text-neutral-300 hover:bg-neutral-700/50 transition-colors opacity-0 group-hover:opacity-100"
                            title="Remove from recents"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </main>
        </>
      )}

      {/* Page & File Tools Modal */}
      <PageToolsModal />

      {/* E-Signature Drawing & Upload Modal */}
      <SignatureModal />

      {/* Auto-Updater Modal */}
      <UpdateModal />
    </div>
  );
}
