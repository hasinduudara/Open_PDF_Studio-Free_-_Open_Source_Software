import { create } from "zustand";
import type * as pdfjsLib from "pdfjs-dist";

export type AnnotationTool = "select" | "highlight" | "note" | "draw";

export interface HighlightAnnotation {
  id: string;
  page: number;
  type: "highlight";
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NoteAnnotation {
  id: string;
  page: number;
  type: "note";
  color: string;
  x: number;
  y: number;
  text: string;
}

export interface DrawAnnotation {
  id: string;
  page: number;
  type: "draw";
  color: string;
  strokeWidth: number;
  points: { x: number; y: number }[];
}

export type PdfAnnotation = HighlightAnnotation | NoteAnnotation | DrawAnnotation;

/**
 * Represents an open PDF document tab in the application.
 */
export interface PdfTab {
  id: string;
  name: string;
  path: string;
  data: Uint8Array;
  currentPage: number;
  numPages: number;
  scale: number;
  rotation: number; // 0, 90, 180, 270 degrees
  scrollTargetPage: number | null; // Non-null only when a programmatic scroll is requested
  annotations: PdfAnnotation[];
}

export type SidebarTab = "thumbnails" | "outline";

export interface SearchMatch {
  page: number;
  matchIndex: number;
}

export interface RecentFile {
  name: string;
  path: string;
  lastOpened: number;
}

const RECENT_FILES_STORAGE_KEY = "open_pdf_studio_recent_files";

function loadPersistedRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(RECENT_FILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistRecentFiles(files: RecentFile[]) {
  try {
    localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(files.slice(0, 10)));
  } catch (err) {
    console.error("Failed to persist recent files to localStorage:", err);
  }
}

/**
 * Zustand state and actions for managing multi-tab PDF documents, search,
 * dark reading mode, recent files, annotations, and layout.
 */
export interface PdfState {
  tabs: PdfTab[];
  activeTabId: string | null;
  isSidebarOpen: boolean;
  sidebarTab: SidebarTab;
  pdfDoc: pdfjsLib.PDFDocumentProxy | null;

  // Search state
  isSearchOpen: boolean;
  searchQuery: string;
  searchMatches: SearchMatch[];
  currentMatchIndex: number;

  // Page reading display mode
  isDarkPageMode: boolean;

  // Recent files list
  recentFiles: RecentFile[];

  // Annotations state
  activeTool: AnnotationTool;
  activeColor: string;

  setPdfDoc: (doc: pdfjsLib.PDFDocumentProxy | null) => void;

  addTab: (tabData: {
    id?: string;
    name: string;
    path: string;
    data: Uint8Array;
    currentPage?: number;
    numPages?: number;
    scale?: number;
    rotation?: number;
    scrollTargetPage?: number | null;
    annotations?: PdfAnnotation[];
  }) => void;

  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  setCurrentPageFromScroll: (page: number) => void;
  jumpToPage: (page: number) => void;
  clearScrollTarget: () => void;
  setPage: (tabId: string, page: number) => void;
  setNumPages: (tabId: string, numPages: number) => void;
  setScale: (tabId: string, scale: number) => void;
  rotateClockwise: (tabId: string) => void;
  rotateCounterClockwise: (tabId: string) => void;
  toggleSidebar: () => void;
  setSidebarTab: (tab: SidebarTab) => void;

  // Search actions
  openSearch: () => void;
  closeSearch: () => void;
  setSearchQuery: (query: string) => void;
  setSearchMatches: (matches: SearchMatch[]) => void;
  setCurrentMatchIndex: (index: number) => void;
  nextSearchMatch: () => void;
  prevSearchMatch: () => void;

  // Dark mode & recent files actions
  toggleDarkPageMode: () => void;
  clearRecentFiles: () => void;
  removeRecentFile: (path: string) => void;

  // Annotation actions
  setActiveTool: (tool: AnnotationTool) => void;
  setActiveColor: (color: string) => void;
  setAnnotations: (tabId: string, annotations: PdfAnnotation[]) => void;
  addAnnotation: (tabId: string, annotation: PdfAnnotation) => void;
  updateAnnotation: (tabId: string, id: string, updates: Partial<PdfAnnotation>) => void;
  deleteAnnotation: (tabId: string, id: string) => void;
  undoLastAnnotation: (tabId?: string) => void;

  // Page & file tools modal state
  isPageToolsOpen: boolean;
  pageToolsInitialTab: "organize" | "merge" | "split";
  openPageTools: (initialTab?: "organize" | "merge" | "split") => void;
  closePageTools: () => void;
  updateTabData: (tabId: string, newData: Uint8Array) => void;
}

export const usePdfStore = create<PdfState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  isSidebarOpen: true,
  sidebarTab: "thumbnails",
  pdfDoc: null,

  isSearchOpen: false,
  searchQuery: "",
  searchMatches: [],
  currentMatchIndex: 0,

  isDarkPageMode: false,
  recentFiles: loadPersistedRecentFiles(),

  activeTool: "select",
  activeColor: "#facc15",

  isPageToolsOpen: false,
  pageToolsInitialTab: "organize",

  setPdfDoc: (doc) => {
    set({ pdfDoc: doc });
  },

  addTab: (tabData) => {
    const { tabs, recentFiles } = get();

    // Update recent files list if file has a valid path
    if (tabData.path && tabData.path.trim().length > 0) {
      const updatedRecent = [
        {
          name: tabData.name,
          path: tabData.path,
          lastOpened: Date.now(),
        },
        ...recentFiles.filter((item) => item.path !== tabData.path),
      ].slice(0, 10);

      persistRecentFiles(updatedRecent);
      set({ recentFiles: updatedRecent });
    }

    // If document with the exact same path is already open, activate that tab
    const existingTabIndex = tabs.findIndex(
      (tab) => tab.path.length > 0 && tab.path === tabData.path
    );

    if (existingTabIndex !== -1) {
      set({ activeTabId: tabs[existingTabIndex].id });
      return;
    }

    const newTab: PdfTab = {
      id: tabData.id || `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: tabData.name,
      path: tabData.path,
      data: tabData.data,
      currentPage: tabData.currentPage ?? 1,
      numPages: tabData.numPages ?? 0,
      scale: tabData.scale ?? 1.2,
      rotation: tabData.rotation ?? 0,
      scrollTargetPage: null,
      annotations: tabData.annotations ?? [],
    };

    set({
      tabs: [...tabs, newTab],
      activeTabId: newTab.id,
    });
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const tabIndex = tabs.findIndex((t) => t.id === id);
    if (tabIndex === -1) return;

    const remainingTabs = tabs.filter((t) => t.id !== id);

    let nextActiveTabId = activeTabId;
    if (activeTabId === id) {
      if (remainingTabs.length === 0) {
        nextActiveTabId = null;
      } else if (tabIndex < remainingTabs.length) {
        nextActiveTabId = remainingTabs[tabIndex].id;
      } else {
        nextActiveTabId = remainingTabs[remainingTabs.length - 1].id;
      }
    }

    set({
      tabs: remainingTabs,
      activeTabId: nextActiveTabId,
      pdfDoc: nextActiveTabId === null ? null : get().pdfDoc,
    });
  },

  setActiveTab: (id) => {
    set({ activeTabId: id });
  },

  setCurrentPageFromScroll: (page) => {
    const { activeTabId } = get();
    if (!activeTabId) return;

    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const targetPage =
          tab.numPages > 0 ? Math.max(1, Math.min(page, tab.numPages)) : Math.max(1, page);
        if (tab.currentPage === targetPage) return tab;
        return { ...tab, currentPage: targetPage };
      }),
    }));
  },

  jumpToPage: (page) => {
    const { activeTabId } = get();
    if (!activeTabId) return;

    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const targetPage =
          tab.numPages > 0 ? Math.max(1, Math.min(page, tab.numPages)) : Math.max(1, page);
        return { ...tab, currentPage: targetPage, scrollTargetPage: targetPage };
      }),
    }));
  },

  clearScrollTarget: () => {
    const { activeTabId } = get();
    if (!activeTabId) return;

    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === activeTabId ? { ...tab, scrollTargetPage: null } : tab
      ),
    }));
  },

  setPage: (tabId, page) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const targetPage =
          tab.numPages > 0 ? Math.max(1, Math.min(page, tab.numPages)) : Math.max(1, page);
        return { ...tab, currentPage: targetPage, scrollTargetPage: targetPage };
      }),
    }));
  },

  setNumPages: (tabId, numPages) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, numPages } : tab)),
    }));
  },

  setScale: (tabId, scale) => {
    const clampedScale = Math.max(0.25, Math.min(scale, 5.0));
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, scale: clampedScale } : tab)),
    }));
  },

  rotateClockwise: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const newRotation = (tab.rotation + 90) % 360;
        return { ...tab, rotation: newRotation };
      }),
    }));
  },

  rotateCounterClockwise: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const newRotation = (tab.rotation + 270) % 360;
        return { ...tab, rotation: newRotation };
      }),
    }));
  },

  toggleSidebar: () => {
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
  },

  setSidebarTab: (tab) => {
    set({ sidebarTab: tab });
  },

  openSearch: () => {
    set({ isSearchOpen: true });
  },

  closeSearch: () => {
    set({
      isSearchOpen: false,
      searchQuery: "",
      searchMatches: [],
      currentMatchIndex: 0,
    });
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  setSearchMatches: (matches) => {
    set({
      searchMatches: matches,
      currentMatchIndex: matches.length > 0 ? 0 : 0,
    });
  },

  setCurrentMatchIndex: (index) => {
    set({ currentMatchIndex: index });
  },

  nextSearchMatch: () => {
    const { searchMatches, currentMatchIndex, jumpToPage } = get();
    if (searchMatches.length === 0) return;

    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    set({ currentMatchIndex: nextIndex });
    jumpToPage(searchMatches[nextIndex].page);
  },

  prevSearchMatch: () => {
    const { searchMatches, currentMatchIndex, jumpToPage } = get();
    if (searchMatches.length === 0) return;

    const prevIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    set({ currentMatchIndex: prevIndex });
    jumpToPage(searchMatches[prevIndex].page);
  },

  toggleDarkPageMode: () => {
    set((state) => ({ isDarkPageMode: !state.isDarkPageMode }));
  },

  clearRecentFiles: () => {
    try {
      localStorage.removeItem(RECENT_FILES_STORAGE_KEY);
    } catch {
      // ignore
    }
    set({ recentFiles: [] });
  },

  removeRecentFile: (path) => {
    const { recentFiles } = get();
    const updated = recentFiles.filter((item) => item.path !== path);
    persistRecentFiles(updated);
    set({ recentFiles: updated });
  },

  // Annotation actions
  setActiveTool: (tool) => {
    set({ activeTool: tool });
  },

  setActiveColor: (color) => {
    set({ activeColor: color });
  },

  setAnnotations: (tabId, annotations) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, annotations } : tab
      ),
    }));
  },

  addAnnotation: (tabId, annotation) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, annotations: [...(tab.annotations || []), annotation] }
          : tab
      ),
    }));
  },

  updateAnnotation: (tabId, id, updates) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        return {
          ...tab,
          annotations: (tab.annotations || []).map((ann) =>
            ann.id === id ? ({ ...ann, ...updates } as PdfAnnotation) : ann
          ),
        };
      }),
    }));
  },

  deleteAnnotation: (tabId, id) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        return {
          ...tab,
          annotations: (tab.annotations || []).filter((ann) => ann.id !== id),
        };
      }),
    }));
  },

  undoLastAnnotation: (tabId) => {
    const targetTabId = tabId || get().activeTabId;
    if (!targetTabId) return;

    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== targetTabId) return tab;
        const currentList = tab.annotations || [];
        if (currentList.length === 0) return tab;
        return {
          ...tab,
          annotations: currentList.slice(0, currentList.length - 1),
        };
      }),
    }));
  },

  // Page & file tools actions
  openPageTools: (initialTab = "organize") => {
    set({ isPageToolsOpen: true, pageToolsInitialTab: initialTab });
  },

  closePageTools: () => {
    set({ isPageToolsOpen: false });
  },

  updateTabData: (tabId, newData) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        return {
          ...tab,
          data: newData,
          currentPage: 1,
          scrollTargetPage: 1,
        };
      }),
    }));
  },
}));
