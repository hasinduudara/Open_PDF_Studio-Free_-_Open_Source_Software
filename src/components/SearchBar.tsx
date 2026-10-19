import { useEffect, useRef, useState } from "react";
import { Search, ChevronUp, ChevronDown, X, Loader2 } from "lucide-react";
import { usePdfStore, type SearchMatch } from "../store/usePdfStore";

/**
 * Floating search bar component anchored to the top-right of the PDF viewer.
 * Scans all document pages via PDF.js getTextContent and allows jumping between matches.
 */
export default function SearchBar() {
  const {
    isSearchOpen,
    closeSearch,
    searchQuery,
    setSearchQuery,
    searchMatches,
    setSearchMatches,
    currentMatchIndex,
    nextSearchMatch,
    prevSearchMatch,
    pdfDoc,
    jumpToPage,
  } = usePdfStore();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const searchGenerationRef = useRef<number>(0);

  // Focus input automatically whenever search is opened
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isSearchOpen]);

  // Scan document pages whenever searchQuery or pdfDoc changes
  useEffect(() => {
    if (!isSearchOpen || !pdfDoc) return;

    const trimmedQuery = searchQuery.trim().toLowerCase();
    if (trimmedQuery.length === 0) {
      setSearchMatches([]);
      setIsScanning(false);
      return;
    }

    const currentGen = ++searchGenerationRef.current;
    setIsScanning(true);

    const timer = setTimeout(async () => {
      try {
        const matches: SearchMatch[] = [];
        let globalIndex = 0;

        for (let p = 1; p <= pdfDoc.numPages; p++) {
          if (searchGenerationRef.current !== currentGen) return;

          const page = await pdfDoc.getPage(p);
          const textContent = await page.getTextContent();

          // Concatenate all text items on this page
          let pageText = "";
          for (const item of textContent.items) {
            if ("str" in item) {
              pageText += item.str + " ";
            }
          }

          const lowerPageText = pageText.toLowerCase();
          let searchPos = 0;

          while (searchPos < lowerPageText.length) {
            const foundIndex = lowerPageText.indexOf(trimmedQuery, searchPos);
            if (foundIndex === -1) break;

            matches.push({
              page: p,
              matchIndex: globalIndex++,
            });

            searchPos = foundIndex + trimmedQuery.length;
          }
        }

        if (searchGenerationRef.current === currentGen) {
          setSearchMatches(matches);
          setIsScanning(false);

          // Jump immediately to the first match if results are found
          if (matches.length > 0) {
            jumpToPage(matches[0].page);
          }
        }
      } catch (err) {
        if (searchGenerationRef.current === currentGen) {
          console.error("Failed during PDF text search scan:", err);
          setIsScanning(false);
        }
      }
    }, 180);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery, pdfDoc, isSearchOpen, setSearchMatches, jumpToPage]);

  if (!isSearchOpen) return null;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        prevSearchMatch();
      } else {
        nextSearchMatch();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  }

  return (
    <div className="absolute top-4 right-6 z-40 flex items-center gap-2 rounded-xl border border-neutral-700/80 bg-neutral-900/95 px-3 py-1.5 shadow-2xl backdrop-blur-md text-xs select-none animate-in fade-in slide-in-from-top-2 duration-150">
      <Search className="h-4 w-4 text-neutral-400 flex-shrink-0" />

      {/* Query Input */}
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in document..."
        className="w-48 bg-transparent text-neutral-100 placeholder-neutral-500 outline-none text-xs"
      />

      {/* Match Status Counter / Scanning Indicator */}
      <div className="flex items-center min-w-[50px] justify-center text-[11px] font-mono text-neutral-400">
        {isScanning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-red-500" />
        ) : searchQuery.trim().length > 0 ? (
          searchMatches.length > 0 ? (
            <span className="text-neutral-300">
              {currentMatchIndex + 1}/{searchMatches.length}
            </span>
          ) : (
            <span className="text-red-400 text-[10px]">0 of 0</span>
          )
        ) : null}
      </div>

      <div className="h-4 w-[1px] bg-neutral-800" />

      {/* Navigation Buttons */}
      <button
        type="button"
        onClick={prevSearchMatch}
        disabled={searchMatches.length === 0}
        className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={nextSearchMatch}
        disabled={searchMatches.length === 0}
        className="rounded p-1 text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
        title="Next match (Enter)"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {/* Close Search */}
      <button
        type="button"
        onClick={closeSearch}
        className="rounded p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
        title="Close (Escape)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
