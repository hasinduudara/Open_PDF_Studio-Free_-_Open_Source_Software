import { useState, useEffect } from "react";
import { FolderOpen, FileText, ShieldCheck, Zap, Layers, UploadCloud } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { usePdfStore } from "./store/usePdfStore";
import Toolbar from "./components/Toolbar";
import TabBar from "./components/TabBar";
import Sidebar from "./components/Sidebar";
import PdfViewer from "./components/PdfViewer";
import "./App.css";

/**
 * Main application container for Open PDF Studio.
 * Handles drag-and-drop file ingestion, multi-tab layout, collapsible sidebar,
 * and empty state document loading.
 */
export default function App() {
  const { tabs, addTab } = usePdfStore();
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  /**
   * Prompts the user to select and open a PDF document from the file system.
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

  // Set up Tauri native window drag and drop listener
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
        // Native Tauri webview drag-drop might not be available in standard browser dev
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
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/20 text-red-500 ring-1 ring-red-500/30">
                <FileText className="h-4 w-4" />
              </div>
              <div className="flex items-baseline gap-2">
                <h1 className="text-sm font-semibold tracking-tight text-neutral-100">
                  Open PDF Studio
                </h1>
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
                  v0.1.0
                </span>
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenPdf}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-red-500 active:bg-red-700"
              >
                <FolderOpen className="h-4 w-4" />
                <span>Open PDF</span>
              </button>
            </div>
          </header>

          {/* Main Workspace / Empty State */}
          <main className="flex flex-1 items-center justify-center p-6">
            <div className="flex max-w-lg flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-800 bg-neutral-900/30 hover:border-neutral-700 hover:bg-neutral-900/50 p-10 text-center transition-all duration-200">
              {/* Central Icon */}
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-800/80 text-neutral-400 ring-1 ring-neutral-700/50">
                <FolderOpen className="h-8 w-8 text-neutral-300" />
              </div>

              <h2 className="text-lg font-semibold text-neutral-100">
                No document loaded
              </h2>
              <p className="mt-1 text-sm text-neutral-400">
                Open a PDF file or drag & drop files here to start reading.
              </p>

              {/* Action Trigger */}
              <button
                type="button"
                onClick={handleOpenPdf}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-500 active:bg-red-700"
              >
                <FolderOpen className="h-4 w-4" />
                <span>Browse Files</span>
              </button>

              {/* Highlights */}
              <div className="mt-8 grid grid-cols-3 gap-3 border-t border-neutral-800/80 pt-6 text-left">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    <span>Fast</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    Smooth rendering powered by PDF.js.
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Private</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    100% offline & local processing.
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
          </main>
        </>
      )}
    </div>
  );
}
