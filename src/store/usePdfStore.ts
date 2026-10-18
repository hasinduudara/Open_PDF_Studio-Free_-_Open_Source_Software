import { create } from "zustand";
import type * as pdfjsLib from "pdfjs-dist";

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
}

export type SidebarTab = "thumbnails" | "outline";

/**
 * Zustand state and actions for managing multi-tab PDF documents and layout.
 */
export interface PdfState {
  tabs: PdfTab[];
  activeTabId: string | null;
  isSidebarOpen: boolean;
  sidebarTab: SidebarTab;
  pdfDoc: pdfjsLib.PDFDocumentProxy | null;

  /**
   * Updates the currently active PDF document proxy reference.
   */
  setPdfDoc: (doc: pdfjsLib.PDFDocumentProxy | null) => void;

  /**
   * Adds a new tab or activates an existing tab if the file path is already open.
   */
  addTab: (tabData: {
    id?: string;
    name: string;
    path: string;
    data: Uint8Array;
    currentPage?: number;
    numPages?: number;
    scale?: number;
    rotation?: number;
  }) => void;

  /**
   * Closes the tab with the specified ID and activates an adjacent tab if necessary.
   */
  closeTab: (id: string) => void;

  /**
   * Switches the active tab to the specified ID.
   */
  setActiveTab: (id: string) => void;

  /**
   * Updates the current page for a specific tab.
   */
  setPage: (tabId: string, page: number) => void;

  /**
   * Updates the total number of pages for a specific tab.
   */
  setNumPages: (tabId: string, numPages: number) => void;

  /**
   * Updates the zoom scale for a specific tab.
   */
  setScale: (tabId: string, scale: number) => void;

  /**
   * Rotates the tab's pages clockwise by 90 degrees.
   */
  rotateClockwise: (tabId: string) => void;

  /**
   * Rotates the tab's pages counter-clockwise by 90 degrees.
   */
  rotateCounterClockwise: (tabId: string) => void;

  /**
   * Toggles visibility of the left sidebar.
   */
  toggleSidebar: () => void;

  /**
   * Sets the active tab inside the left sidebar (thumbnails or outline).
   */
  setSidebarTab: (tab: SidebarTab) => void;
}

export const usePdfStore = create<PdfState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  isSidebarOpen: true,
  sidebarTab: "thumbnails",
  pdfDoc: null,

  setPdfDoc: (doc) => {
    set({ pdfDoc: doc });
  },

  addTab: (tabData) => {
    const { tabs } = get();

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

  setPage: (tabId, page) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const targetPage =
          tab.numPages > 0 ? Math.max(1, Math.min(page, tab.numPages)) : Math.max(1, page);
        return { ...tab, currentPage: targetPage };
      }),
    }));
  },

  setNumPages: (tabId, numPages) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, numPages } : tab)),
    }));
  },

  setScale: (tabId, scale) => {
    // Keep scale within sensible viewing bounds: 25% to 500%
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
}));
