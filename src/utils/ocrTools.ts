import { createWorker } from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Configure worker for Vite environment
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type OcrLanguage = "eng" | "sin" | "tam";

export interface OcrProgressInfo {
  status: string;
  progress: number;
}

/**
 * Initializes a Tesseract worker, runs recognition on the image data,
 * terminates the worker, and returns the recognized text.
 *
 * @param imageDataUrl Base64 or Object URL of the image to recognize.
 * @param language OCR language code ('eng' for English, 'sin' for Sinhala, 'tam' for Tamil).
 * @param onProgress Optional progress callback to monitor OCR stages and progress (0.0 to 1.0).
 * @returns Recognized text content.
 */
export async function extractTextFromImage(
  imageDataUrl: string,
  language: "eng" | "sin" | "tam",
  onProgress?: (info: OcrProgressInfo) => void
): Promise<string> {
  if (!imageDataUrl) {
    throw new Error("No image data provided for OCR.");
  }

  const worker = await createWorker(language, undefined, {
    logger: (message) => {
      if (onProgress && message) {
        onProgress({
          status: message.status || "processing",
          progress: typeof message.progress === "number" ? message.progress : 0,
        });
      }
    },
  });

  try {
    const result = await worker.recognize(imageDataUrl);
    return result.data.text || "";
  } finally {
    await worker.terminate();
  }
}

/**
 * Renders a specific PDF page to a base64 PNG data URL using pdfjs-dist.
 *
 * @param docOrData Active PDFDocumentProxy instance or raw Uint8Array document buffer.
 * @param pageNumber 1-based page number to render.
 * @param scale Quality scale factor (default 2.0 for higher OCR resolution).
 * @returns Base64 image data URL of the rendered page.
 */
export async function renderPdfPageToDataUrl(
  docOrData: pdfjsLib.PDFDocumentProxy | Uint8Array,
  pageNumber: number,
  scale: number = 2.0
): Promise<string> {
  let doc: pdfjsLib.PDFDocumentProxy;

  if (docOrData instanceof Uint8Array) {
    const loadingTask = pdfjsLib.getDocument({ data: docOrData.slice() });
    doc = await loadingTask.promise;
  } else {
    doc = docOrData;
  }

  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("Failed to create 2D canvas context for rendering.");
  }

  // Draw clean white background behind text
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
  }).promise;

  return canvas.toDataURL("image/png");
}
