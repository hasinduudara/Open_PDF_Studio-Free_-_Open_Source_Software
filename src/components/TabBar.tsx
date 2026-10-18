import { X, FileText, Plus } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { usePdfStore } from "../store/usePdfStore";

/**
 * Tab bar component displaying all currently open PDF documents,
 * allowing users to switch between documents, close them, or open additional files.
 */
export default function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, addTab } = usePdfStore();

  /**
   * Triggers the native open dialog to add a new document as a tab.
   */
  async function handleOpenNewTab() {
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
      console.error("Failed to open document:", error);
    }
  }

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="flex h-9 items-center border-b border-neutral-800 bg-neutral-950 px-2 text-xs select-none">
      {/* Scrollable Tabs List */}
      <div className="flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group relative flex h-7 max-w-[200px] cursor-pointer items-center gap-2 rounded-t-md px-3 font-medium transition-colors ${
                isActive
                  ? "bg-neutral-900 text-neutral-100 border-t-2 border-red-500 shadow-sm"
                  : "bg-transparent text-neutral-400 hover:bg-neutral-900/60 hover:text-neutral-200"
              }`}
              title={tab.path || tab.name}
            >
              <FileText
                className={`h-3.5 w-3.5 flex-shrink-0 ${
                  isActive ? "text-red-400" : "text-neutral-500 group-hover:text-neutral-400"
                }`}
              />
              <span className="truncate text-[11px]">{tab.name}</span>

              {/* Close Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={`rounded p-0.5 transition-colors ${
                  isActive
                    ? "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                    : "text-neutral-600 opacity-60 hover:bg-neutral-800 hover:text-neutral-200 group-hover:opacity-100"
                }`}
                title="Close Tab"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        {/* Quick New Tab Button */}
        <button
          type="button"
          onClick={handleOpenNewTab}
          className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-200"
          title="Open another PDF"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
