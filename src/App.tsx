import { useState } from "react";
import { FolderOpen, FileText, ShieldCheck, Zap, Layers } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { usePdfStore } from "./store/usePdfStore";
import Toolbar from "./components/Toolbar";
import TabBar from "./components/TabBar";
import PdfViewer from "./components/PdfViewer";
import "./App.css";

/**
 * Main application container for Open PDF Studio.
 * Conditionally displays the multi-tab PDF workspace or an empty state prompt.
 */
export default function App() {
  const { tabs, addTab } = usePdfStore();
  const [isHovered, setIsHovered] = useState<boolean>(false);

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

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-100 select-none overflow-hidden">
      {tabs.length > 0 ? (
        <>
          {/* Active Tabs Navigation */}
          <TabBar />

          {/* Navigation and Viewing Toolbar */}
          <Toolbar />

          {/* PDF Rendering Canvas Workspace */}
          <PdfViewer />
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
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsHovered(true);
              }}
              onDragLeave={() => setIsHovered(false)}
              className={`flex max-w-lg flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-200 ${
                isHovered
                  ? "border-red-500/80 bg-neutral-900/60 shadow-lg shadow-red-500/10"
                  : "border-neutral-800 bg-neutral-900/30 hover:border-neutral-700 hover:bg-neutral-900/50"
              }`}
            >
              {/* Central Icon */}
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-800/80 text-neutral-400 ring-1 ring-neutral-700/50">
                <FolderOpen className="h-8 w-8 text-neutral-300" />
              </div>

              <h2 className="text-lg font-semibold text-neutral-100">
                No document loaded
              </h2>
              <p className="mt-1 text-sm text-neutral-400">
                Open a PDF file to view pages, navigate outlines, and inspect metadata.
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
