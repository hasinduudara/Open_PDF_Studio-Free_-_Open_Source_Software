import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { PdfTab } from "../store/usePdfStore";

/**
 * Parses a hex color string (e.g. "#facc15" or "#fff") into a pdf-lib RGB color object.
 */
function hexToRgb(hex: string) {
  let cleanHex = hex.replace("#", "");
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(cleanHex, 16);
  if (isNaN(num)) {
    return rgb(0.98, 0.8, 0.08); // fallback yellow
  }
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return rgb(r, g, b);
}

/**
 * Saves the active PDF tab with all applied annotations (highlights, drawings, notes)
 * baked directly onto the PDF document using pdf-lib and Tauri's native save dialog.
 *
 * @param tab The PdfTab containing raw PDF bytes and annotations.
 * @returns The destination file path if saved, or null if cancelled.
 */
export async function saveAnnotatedPdf(tab: PdfTab): Promise<string | null> {
  if (!tab || !tab.data) {
    console.error("No PDF data found in tab.");
    return null;
  }

  try {
    const pdfDoc = await PDFDocument.load(tab.data);
    const pages = pdfDoc.getPages();
    const helveticaFont = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);

    const annotations = tab.annotations || [];

    // Embed serialized annotations into document metadata for persistent re-hydration
    const serializedAnnotations = "OPEN_PDF_STUDIO_ANNOTATIONS:" + JSON.stringify(annotations);
    pdfDoc.setKeywords([serializedAnnotations]);
    pdfDoc.setSubject(serializedAnnotations);

    for (const ann of annotations) {
      const pageIndex = ann.page - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) continue;

      const page = pages[pageIndex];
      const { width: pageWidth, height: pageHeight } = page.getSize();
      const color = hexToRgb(ann.color || "#facc15");

      if (ann.type === "highlight") {
        // Convert normalized (0..1) coordinates to PDF page coordinates.
        // Screen origin is top-left, while PDF origin is bottom-left.
        const x = ann.x * pageWidth;
        const width = ann.width * pageWidth;
        const height = ann.height * pageHeight;
        const y = (1 - ann.y - ann.height) * pageHeight;

        page.drawRectangle({
          x,
          y,
          width,
          height,
          color,
          opacity: 0.35,
        });
      } else if (ann.type === "draw") {
        if (!ann.points || ann.points.length < 2) continue;

        for (let i = 0; i < ann.points.length - 1; i++) {
          const p1 = ann.points[i];
          const p2 = ann.points[i + 1];

          page.drawLine({
            start: {
              x: p1.x * pageWidth,
              y: (1 - p1.y) * pageHeight,
            },
            end: {
              x: p2.x * pageWidth,
              y: (1 - p2.y) * pageHeight,
            },
            thickness: ann.strokeWidth || 3,
            color,
            opacity: 0.85,
          });
        }
      } else if (ann.type === "note") {
        const x = ann.x * pageWidth;
        const y = (1 - ann.y) * pageHeight;

        // Draw clean circular note marker pin
        page.drawCircle({
          x,
          y,
          size: 9,
          color,
          opacity: 0.95,
          borderWidth: 0.8,
          borderColor: rgb(0.15, 0.15, 0.15),
        });

        // Draw inner speech-bubble / note indicator icon
        page.drawCircle({
          x,
          y,
          size: 4.5,
          color: rgb(1, 1, 1),
          opacity: 0.9,
        });
        page.drawCircle({
          x,
          y,
          size: 2,
          color,
          opacity: 0.9,
        });

        // Draw comment label pill if text is present
        if (ann.text && ann.text.trim().length > 0) {
          const maxChar = 70;
          const labelText =
            ann.text.length > maxChar ? `${ann.text.slice(0, maxChar)}...` : ann.text;

          const textWidth = helveticaFont.widthOfTextAtSize(labelText, 8.5);
          page.drawRectangle({
            x: x + 13,
            y: Math.max(4, y - 7),
            width: textWidth + 12,
            height: 15,
            color: rgb(1, 1, 1),
            opacity: 0.95,
            borderColor: rgb(0.75, 0.75, 0.75),
            borderWidth: 0.5,
          });

          page.drawText(labelText, {
            x: x + 19,
            y: Math.max(7, y - 3),
            size: 8.5,
            font: helveticaFont,
            color: rgb(0.15, 0.15, 0.15),
          });
        }
      }
    }

    // Prompt user with Tauri native save dialog
    const defaultFileName = tab.name.endsWith(".pdf") ? tab.name : `${tab.name}.pdf`;
    const targetPath = await save({
      defaultPath: defaultFileName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (!targetPath) {
      return null;
    }

    const pdfBytes = await pdfDoc.save();
    await writeFile(targetPath, pdfBytes);

    return targetPath;
  } catch (error) {
    console.error("Failed to save annotated PDF:", error);
    throw error;
  }
}
