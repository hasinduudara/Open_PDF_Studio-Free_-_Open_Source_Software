import { PDFDocument, StandardFonts, rgb, degrees, type PDFPage } from "pdf-lib";
import { parsePageRanges } from "./pdfPageTools";

export type WatermarkPosition =
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "tile";

export interface WatermarkOptions {
  type: "text" | "image";
  text?: string;
  imageData?: Uint8Array;
  imageFormat?: "png" | "jpg";
  fontSize?: number; // default 50
  color?: string; // hex string, e.g. "#6b7280"
  opacity?: number; // 0.05 to 1.0, default 0.25
  rotation?: number; // degrees, e.g. -45, 0, 45, default -45
  position?: WatermarkPosition; // default "center"
  imageScale?: number; // 0.1 to 1.0, default 0.5
  pageRange?: string; // "all" or "1-5"
}

export type PageNumberFormat =
  | "number" // "1"
  | "page-n" // "Page 1"
  | "page-n-of-total" // "Page 1 of 10"
  | "dash-n-dash"; // "- 1 -"

export type PageNumberPosition =
  | "bottom-center"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "top-right"
  | "top-left";

export interface HeaderFooterOptions {
  // Headers (top margin)
  headerLeft?: string;
  headerCenter?: string;
  headerRight?: string;

  // Footers (bottom margin)
  footerLeft?: string;
  footerCenter?: string;
  footerRight?: string;

  // Page numbering
  includePageNumbers?: boolean;
  pageNumberFormat?: PageNumberFormat;
  pageNumberPosition?: PageNumberPosition;
  pageNumberStartOffset?: number; // starting page number value, default 1
  pageNumberMargin?: number; // margin offset from edge in pt, default 30

  // Common styling
  fontSize?: number; // default 10
  color?: string; // hex string, default "#4b5563"
  pageRange?: string; // "all" or "1-5"
}

/**
 * Converts a hex color string (e.g. "#ef4444" or "ef4444") to pdf-lib rgb format (0..1).
 */
export function hexToRgb(hex: string) {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const val = parseInt(clean, 16);
  if (isNaN(val)) return rgb(0.3, 0.3, 0.3);
  const r = ((val >> 16) & 255) / 255;
  const g = ((val >> 8) & 255) / 255;
  const b = (val & 255) / 255;
  return rgb(r, g, b);
}

/**
 * Resolves targeted 0-based page indices from a page range string.
 */
function resolveTargetPages(pageRange: string | undefined, totalPages: number): number[] {
  if (!pageRange || pageRange.trim().toLowerCase() === "all") {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const parsed = parsePageRanges(pageRange, totalPages);
  const set = new Set<number>();
  for (const item of parsed) {
    for (const p of item.pages) {
      if (p >= 0 && p < totalPages) {
        set.add(p);
      }
    }
  }

  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Calculates bottom-left (x, y) coordinates for an object with dimensions (W, H)
 * so that when rotated by angle degrees around (x, y), its center point equals (targetCx, targetCy).
 */
function computeRotatedOrigin(
  targetCx: number,
  targetCy: number,
  width: number,
  height: number,
  rotationDegrees: number
): { x: number; y: number } {
  const rad = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const x = targetCx - (width / 2) * cos + (height / 2) * sin;
  const y = targetCy - (width / 2) * sin - (height / 2) * cos;
  return { x, y };
}

/**
 * Generates center anchor coordinates based on requested watermark position.
 */
function getWatermarkCenters(
  pos: WatermarkPosition,
  pageWidth: number,
  pageHeight: number
): { cx: number; cy: number }[] {
  switch (pos) {
    case "top-left":
      return [{ cx: pageWidth * 0.25, cy: pageHeight * 0.75 }];
    case "top-right":
      return [{ cx: pageWidth * 0.75, cy: pageHeight * 0.75 }];
    case "bottom-left":
      return [{ cx: pageWidth * 0.25, cy: pageHeight * 0.25 }];
    case "bottom-right":
      return [{ cx: pageWidth * 0.75, cy: pageHeight * 0.25 }];
    case "tile":
      return [
        { cx: pageWidth * 0.25, cy: pageHeight * 0.8 },
        { cx: pageWidth * 0.75, cy: pageHeight * 0.8 },
        { cx: pageWidth * 0.25, cy: pageHeight * 0.5 },
        { cx: pageWidth * 0.75, cy: pageHeight * 0.5 },
        { cx: pageWidth * 0.25, cy: pageHeight * 0.2 },
        { cx: pageWidth * 0.75, cy: pageHeight * 0.2 },
      ];
    case "center":
    default:
      return [{ cx: pageWidth / 2, cy: pageHeight / 2 }];
  }
}

/**
 * Applies a text or image watermark to the specified pages of a PDF document.
 *
 * @param sourceData Raw Uint8Array of the source PDF.
 * @param options Watermark configuration options.
 * @returns Modified PDF document as a Uint8Array.
 */
export async function applyWatermarkToPdf(
  sourceData: Uint8Array,
  options: WatermarkOptions
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(sourceData, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  if (totalPages === 0) return sourceData;

  const targetPages = resolveTargetPages(options.pageRange, totalPages);
  if (targetPages.length === 0) return sourceData;

  const opacity = Math.max(0.05, Math.min(options.opacity ?? 0.25, 1.0));
  const rotation = options.rotation ?? -45;
  const position = options.position ?? "center";

  if (options.type === "image" && options.imageData) {
    // Attempt to embed as PNG or JPEG
    let embeddedImg;
    const isPng =
      options.imageFormat === "png" ||
      (options.imageData[0] === 0x89 && options.imageData[1] === 0x50);

    try {
      if (isPng) {
        embeddedImg = await pdfDoc.embedPng(options.imageData);
      } else {
        embeddedImg = await pdfDoc.embedJpg(options.imageData);
      }
    } catch {
      // Fallback attempt with the other format
      try {
        if (isPng) {
          embeddedImg = await pdfDoc.embedJpg(options.imageData);
        } else {
          embeddedImg = await pdfDoc.embedPng(options.imageData);
        }
      } catch (err) {
        throw new Error("Unable to parse watermark image. Please provide a valid PNG or JPG file.");
      }
    }

    const scale = Math.max(0.05, Math.min(options.imageScale ?? 0.5, 2.0));

    for (const pageIndex of targetPages) {
      const page = pdfDoc.getPage(pageIndex);
      const { width: pWidth, height: pHeight } = page.getSize();

      // Fit image naturally relative to page scale
      const maxDim = Math.min(pWidth, pHeight) * 0.6 * scale;
      const imgAspect = embeddedImg.width / embeddedImg.height;
      let drawW = maxDim;
      let drawH = maxDim / imgAspect;
      if (drawH > maxDim) {
        drawH = maxDim;
        drawW = maxDim * imgAspect;
      }

      const centers = getWatermarkCenters(position, pWidth, pHeight);
      for (const { cx, cy } of centers) {
        const { x, y } = computeRotatedOrigin(cx, cy, drawW, drawH, rotation);
        page.drawImage(embeddedImg, {
          x,
          y,
          width: drawW,
          height: drawH,
          opacity,
          rotate: degrees(rotation),
        });
      }
    }
  } else {
    // Text watermark
    const text = options.text?.trim() || "CONFIDENTIAL";
    const fontSize = options.fontSize ?? 48;
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const color = hexToRgb(options.color ?? "#9ca3af");

    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = font.heightAtSize(fontSize);

    for (const pageIndex of targetPages) {
      const page = pdfDoc.getPage(pageIndex);
      const { width: pWidth, height: pHeight } = page.getSize();

      const centers = getWatermarkCenters(position, pWidth, pHeight);
      for (const { cx, cy } of centers) {
        const { x, y } = computeRotatedOrigin(cx, cy, textWidth, textHeight, rotation);
        page.drawText(text, {
          x,
          y,
          size: fontSize,
          font,
          color,
          opacity,
          rotate: degrees(rotation),
        });
      }
    }
  }

  return await pdfDoc.save();
}

/**
 * Formats a page number string based on format type and offsets.
 */
function formatPageNumberText(
  format: PageNumberFormat,
  pageNum: number,
  totalPages: number
): string {
  switch (format) {
    case "page-n":
      return `Page ${pageNum}`;
    case "page-n-of-total":
      return `Page ${pageNum} of ${totalPages}`;
    case "dash-n-dash":
      return `- ${pageNum} -`;
    case "number":
    default:
      return `${pageNum}`;
  }
}

/**
 * Draws text safely on a PDF page at the specified location.
 */
function drawSlotText(
  page: PDFPage,
  text: string,
  align: "left" | "center" | "right",
  y: number,
  margin: number,
  font: any,
  fontSize: number,
  color: any
) {
  if (!text || text.trim().length === 0) return;
  const pWidth = page.getWidth();
  const textWidth = font.widthOfTextAtSize(text, fontSize);

  let x = margin;
  if (align === "center") {
    x = pWidth / 2 - textWidth / 2;
  } else if (align === "right") {
    x = pWidth - margin - textWidth;
  }

  page.drawText(text, {
    x,
    y,
    size: fontSize,
    font,
    color,
  });
}

/**
 * Applies custom headers, footers, and dynamic page numbering to a PDF document.
 *
 * @param sourceData Raw Uint8Array of the source PDF.
 * @param options Header, footer, and page numbering configuration.
 * @returns Modified PDF document as a Uint8Array.
 */
export async function applyHeaderFooterAndPageNumbers(
  sourceData: Uint8Array,
  options: HeaderFooterOptions
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(sourceData, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  if (totalPages === 0) return sourceData;

  const targetPages = resolveTargetPages(options.pageRange, totalPages);
  if (targetPages.length === 0) return sourceData;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = options.fontSize ?? 10;
  const color = hexToRgb(options.color ?? "#4b5563");
  const margin = options.pageNumberMargin ?? 30;

  const startOffset = options.pageNumberStartOffset ?? 1;
  const pageNumFormat = options.pageNumberFormat ?? "page-n";
  const pageNumPos = options.pageNumberPosition ?? "bottom-center";

  for (let i = 0; i < targetPages.length; i++) {
    const pageIndex = targetPages[i];
    const page = pdfDoc.getPage(pageIndex);
    const pHeight = page.getHeight();

    const headerY = pHeight - margin;
    const footerY = margin;

    // Build slots
    let hLeft = options.headerLeft || "";
    let hCenter = options.headerCenter || "";
    let hRight = options.headerRight || "";

    let fLeft = options.footerLeft || "";
    let fCenter = options.footerCenter || "";
    let fRight = options.footerRight || "";

    // Inject dynamic page number into corresponding slot
    if (options.includePageNumbers) {
      const pageNumVal = startOffset + i;
      const pageStr = formatPageNumberText(pageNumFormat, pageNumVal, totalPages);

      switch (pageNumPos) {
        case "top-left":
          hLeft = hLeft ? `${hLeft}  |  ${pageStr}` : pageStr;
          break;
        case "top-center":
          hCenter = hCenter ? `${hCenter}  |  ${pageStr}` : pageStr;
          break;
        case "top-right":
          hRight = hRight ? `${pageStr}  |  ${hRight}` : pageStr;
          break;
        case "bottom-left":
          fLeft = fLeft ? `${fLeft}  |  ${pageStr}` : pageStr;
          break;
        case "bottom-right":
          fRight = fRight ? `${pageStr}  |  ${fRight}` : pageStr;
          break;
        case "bottom-center":
        default:
          fCenter = fCenter ? `${fCenter}  |  ${pageStr}` : pageStr;
          break;
      }
    }

    // Render Headers
    drawSlotText(page, hLeft, "left", headerY, margin, font, fontSize, color);
    drawSlotText(page, hCenter, "center", headerY, margin, font, fontSize, color);
    drawSlotText(page, hRight, "right", headerY, margin, font, fontSize, color);

    // Render Footers
    drawSlotText(page, fLeft, "left", footerY, margin, font, fontSize, color);
    drawSlotText(page, fCenter, "center", footerY, margin, font, fontSize, color);
    drawSlotText(page, fRight, "right", footerY, margin, font, fontSize, color);
  }

  return await pdfDoc.save();
}
