import { PDFDocument, degrees } from "pdf-lib";

export interface PageOperation {
  originalPageIndex: number; // 0-based index in the source PDF
  rotationDelta: number; // e.g. 0, 90, 180, 270 degrees
}

export interface SplitRange {
  label: string;
  pages: number[]; // 0-based page indices
}

/**
 * Merges multiple PDF files in the specified order into a single PDF document.
 *
 * @param files Array of PDF files with their names and raw Uint8Array data.
 * @returns Combined PDF as a Uint8Array.
 */
export async function mergePdfFiles(
  files: { name: string; data: Uint8Array }[]
): Promise<Uint8Array> {
  if (files.length === 0) {
    throw new Error("No PDF files provided to merge.");
  }

  const mergedDoc = await PDFDocument.create();

  for (const file of files) {
    try {
      const srcDoc = await PDFDocument.load(file.data, { ignoreEncryption: true });
      const pageIndices = srcDoc.getPageIndices();
      const copiedPages = await mergedDoc.copyPages(srcDoc, pageIndices);
      for (const page of copiedPages) {
        mergedDoc.addPage(page);
      }
    } catch (err) {
      console.error(`Failed to load or copy pages from "${file.name}":`, err);
      throw new Error(
        `Failed to merge "${file.name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return await mergedDoc.save();
}

/**
 * Applies reorder, rotation, and deletion operations to generate a new PDF document.
 *
 * @param sourceData The original PDF document bytes.
 * @param operations Array of desired pages in target sequence with their rotation adjustments.
 * @returns Re-organized PDF as a Uint8Array.
 */
export async function applyPageOperations(
  sourceData: Uint8Array,
  operations: PageOperation[]
): Promise<Uint8Array> {
  if (operations.length === 0) {
    throw new Error("At least one page must be preserved in the document.");
  }

  const srcDoc = await PDFDocument.load(sourceData, { ignoreEncryption: true });
  const totalSrcPages = srcDoc.getPageCount();
  const newDoc = await PDFDocument.create();

  for (const op of operations) {
    if (op.originalPageIndex < 0 || op.originalPageIndex >= totalSrcPages) {
      continue;
    }

    const [copiedPage] = await newDoc.copyPages(srcDoc, [op.originalPageIndex]);

    // Apply rotation delta (0, 90, 180, 270)
    if (op.rotationDelta !== 0) {
      const currentAngle = copiedPage.getRotation().angle;
      const newAngle = ((currentAngle + op.rotationDelta) % 360 + 360) % 360;
      copiedPage.setRotation(degrees(newAngle));
    }

    newDoc.addPage(copiedPage);
  }

  return await newDoc.save();
}

/**
 * Parses page range strings such as "1-3, 4-6, 7" into structured zero-based page lists.
 *
 * @param rangesString User-provided range string (1-based page numbers).
 * @param totalPages The total number of pages in the PDF document.
 */
export function parsePageRanges(
  rangesString: string,
  totalPages: number
): SplitRange[] {
  const parts = rangesString.split(",").map((s) => s.trim()).filter(Boolean);
  const results: SplitRange[] = [];

  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-").map((s) => s.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
        const clampedStart = Math.min(start, totalPages);
        const clampedEnd = Math.min(end, totalPages);
        const pages: number[] = [];
        for (let p = clampedStart; p <= clampedEnd; p++) {
          pages.push(p - 1);
        }
        if (pages.length > 0) {
          results.push({
            label: `Pages_${clampedStart}-${clampedEnd}`,
            pages,
          });
        }
      }
    } else {
      const pageNum = parseInt(part, 10);
      if (!isNaN(pageNum) && pageNum > 0 && pageNum <= totalPages) {
        results.push({
          label: `Page_${pageNum}`,
          pages: [pageNum - 1],
        });
      }
    }
  }

  return results;
}

/**
 * Generates a range string to split a document into chunks of N pages (e.g. "1-2, 3-4, 5-6").
 */
export function generateEveryNPageRanges(totalPages: number, n: number): string {
  if (n <= 0) return `1-${totalPages}`;
  const parts: string[] = [];
  for (let i = 1; i <= totalPages; i += n) {
    const end = Math.min(i + n - 1, totalPages);
    parts.push(i === end ? `${i}` : `${i}-${end}`);
  }
  return parts.join(", ");
}

/**
 * Splits a PDF document into multiple documents according to the provided range string.
 *
 * @param sourceData The original PDF document bytes.
 * @param rangesString User-provided range string (e.g. "1-3, 4-6, 7").
 * @returns Array of resulting PDF documents with labels and Uint8Array data.
 */
export async function splitPdfByRanges(
  sourceData: Uint8Array,
  rangesString: string
): Promise<{ label: string; data: Uint8Array }[]> {
  const srcDoc = await PDFDocument.load(sourceData, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const ranges = parsePageRanges(rangesString, totalPages);

  if (ranges.length === 0) {
    throw new Error(
      "No valid page ranges detected. Please specify ranges like: 1-3, 4-6, 7"
    );
  }

  const results: { label: string; data: Uint8Array }[] = [];

  for (const r of ranges) {
    const newDoc = await PDFDocument.create();
    const copiedPages = await newDoc.copyPages(srcDoc, r.pages);
    for (const page of copiedPages) {
      newDoc.addPage(page);
    }
    const data = await newDoc.save();
    results.push({
      label: r.label,
      data,
    });
  }

  return results;
}
