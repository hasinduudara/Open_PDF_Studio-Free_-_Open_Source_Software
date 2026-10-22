import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument } from "pdf-lib";

// Ensure worker is configured for Vite environment
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ImageInputFile {
  name: string;
  data: Uint8Array;
  type?: string;
}

export interface ExportedPdfImage {
  page: number;
  data: Uint8Array;
  name: string;
}

export type CompressionQuality = "high" | "medium" | "low";

/**
 * Converts multiple image files (PNG/JPEG) into a single PDF document.
 * Each image becomes a page matching the image dimensions.
 *
 * @param imageFiles List of image files with their raw Uint8Array data.
 * @param fitToA4 Optional boolean to scale and center images onto standard A4 pages.
 * @returns Generated PDF document as a Uint8Array.
 */
export async function imagesToPdf(
  imageFiles: ImageInputFile[],
  fitToA4: boolean = false
): Promise<Uint8Array> {
  if (imageFiles.length === 0) {
    throw new Error("No image files provided to convert.");
  }

  const pdfDoc = await PDFDocument.create();

  // Standard A4 dimensions in points: 595.28 x 841.89
  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;

  for (const imgFile of imageFiles) {
    const isPng =
      imgFile.name.toLowerCase().endsWith(".png") ||
      (imgFile.type && imgFile.type.includes("png")) ||
      (imgFile.data[0] === 0x89 && imgFile.data[1] === 0x50);

    let embeddedImg;
    try {
      if (isPng) {
        embeddedImg = await pdfDoc.embedPng(imgFile.data);
      } else {
        embeddedImg = await pdfDoc.embedJpg(imgFile.data);
      }
    } catch {
      // Fallback cross-format attempt
      try {
        if (isPng) {
          embeddedImg = await pdfDoc.embedJpg(imgFile.data);
        } else {
          embeddedImg = await pdfDoc.embedPng(imgFile.data);
        }
      } catch (err) {
        console.error(`Failed to embed image "${imgFile.name}":`, err);
        throw new Error(
          `Unable to parse image "${imgFile.name}". Please ensure it is a valid PNG or JPEG file.`
        );
      }
    }

    if (fitToA4) {
      const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
      const imgAspect = embeddedImg.width / embeddedImg.height;
      const pageAspect = A4_WIDTH / A4_HEIGHT;

      let drawW: number;
      let drawH: number;

      // Fit with 30pt margin
      const margin = 30;
      const maxW = A4_WIDTH - margin * 2;
      const maxH = A4_HEIGHT - margin * 2;

      if (imgAspect > pageAspect) {
        drawW = maxW;
        drawH = maxW / imgAspect;
      } else {
        drawH = maxH;
        drawW = maxH * imgAspect;
      }

      const x = (A4_WIDTH - drawW) / 2;
      const y = (A4_HEIGHT - drawH) / 2;

      page.drawImage(embeddedImg, {
        x,
        y,
        width: drawW,
        height: drawH,
      });
    } else {
      // Exact matching page size
      const page = pdfDoc.addPage([embeddedImg.width, embeddedImg.height]);
      page.drawImage(embeddedImg, {
        x: 0,
        y: 0,
        width: embeddedImg.width,
        height: embeddedImg.height,
      });
    }
  }

  return await pdfDoc.save();
}

/**
 * Renders each page of a PDF document onto a canvas and converts it into image files.
 *
 * @param sourceData Raw Uint8Array of the source PDF.
 * @param format Target image format ("png" or "jpeg").
 * @param scale Resolution scaling multiplier (e.g. 1.0, 2.0, 3.0).
 * @param onProgress Optional callback invoked as each page is converted.
 * @returns Array of rendered images with page number, raw Uint8Array, and suggested filename.
 */
export async function pdfToImages(
  sourceData: Uint8Array,
  format: "png" | "jpeg",
  scale: number = 2.0,
  onProgress?: (current: number, total: number) => void
): Promise<ExportedPdfImage[]> {
  const loadingTask = pdfjsLib.getDocument({ data: sourceData.slice() });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const results: ExportedPdfImage[] = [];
  const mimeType = format === "png" ? "image/png" : "image/jpeg";
  const ext = format === "png" ? "png" : "jpg";

  for (let p = 1; p <= numPages; p++) {
    if (onProgress) {
      onProgress(p, numPages);
    }

    const page = await pdfDoc.getPage(p);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("Failed to acquire 2D rendering context for canvas.");
    }

    // Fill clean white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    }).promise;

    // Convert canvas to binary blob
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, format === "jpeg" ? 0.92 : undefined)
    );

    if (!blob) {
      throw new Error(`Failed to encode canvas to ${format} for page ${p}.`);
    }

    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    results.push({
      page: p,
      data,
      name: `page_${String(p).padStart(3, "0")}.${ext}`,
    });
  }

  return results;
}

/**
 * Compresses a PDF document by rasterizing its pages at a lower resolution / JPEG quality
 * and rebuilding a flattened PDF document using pdf-lib.
 *
 * @param sourceData Raw Uint8Array of the source PDF.
 * @param quality Compression strength ("high" = minor compression, "low" = maximum reduction).
 * @param onProgress Optional callback invoked per page.
 * @returns Compressed PDF document as a Uint8Array.
 */
export async function compressPdf(
  sourceData: Uint8Array,
  quality: CompressionQuality = "medium",
  onProgress?: (current: number, total: number) => void
): Promise<Uint8Array> {
  const loadingTask = pdfjsLib.getDocument({ data: sourceData.slice() });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  if (numPages === 0) return sourceData;

  // Determine scale and JPEG compression quality factors
  let renderScale: number;
  let jpegQualityFactor: number;

  switch (quality) {
    case "high":
      renderScale = 1.8;
      jpegQualityFactor = 0.75;
      break;
    case "low":
      renderScale = 1.0;
      jpegQualityFactor = 0.35;
      break;
    case "medium":
    default:
      renderScale = 1.35;
      jpegQualityFactor = 0.55;
      break;
  }

  const newPdfDoc = await PDFDocument.create();

  for (let p = 1; p <= numPages; p++) {
    if (onProgress) {
      onProgress(p, numPages);
    }

    const page = await pdfDoc.getPage(p);

    // Get unscaled viewport for physical page dimensions
    const origViewport = page.getViewport({ scale: 1.0 });

    // Render scaled for compression
    const renderViewport = page.getViewport({ scale: renderScale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) continue;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport: renderViewport,
    }).promise;

    // Convert to compressed JPEG blob
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", jpegQualityFactor)
    );

    if (!blob) continue;

    const arrayBuffer = await blob.arrayBuffer();
    const jpegBytes = new Uint8Array(arrayBuffer);

    // Embed compressed JPEG
    const embeddedImg = await newPdfDoc.embedJpg(jpegBytes);

    // Add page with original physical dimensions
    const newPage = newPdfDoc.addPage([origViewport.width, origViewport.height]);
    newPage.drawImage(embeddedImg, {
      x: 0,
      y: 0,
      width: origViewport.width,
      height: origViewport.height,
    });
  }

  return await newPdfDoc.save();
}
