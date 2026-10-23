import { useState, useRef, useEffect } from "react";
import {
  X,
  PenTool,
  Upload,
  RotateCcw,
  Trash2,
  Check,
  FileSignature,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { usePdfStore, type SignatureAnnotation } from "../store/usePdfStore";

interface StrokePoint {
  x: number;
  y: number;
}

interface Stroke {
  points: StrokePoint[];
  color: string;
  width: number;
}

/**
 * Modal dialog for drawing or uploading an electronic signature,
 * which can then be placed directly onto the active PDF document.
 */
export default function SignatureModal() {
  const {
    isSignatureModalOpen,
    closeSignatureModal,
    activeTabId,
    tabs,
    addAnnotation,
    setActiveTool,
  } = usePdfStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const [activeTabMode, setActiveTabMode] = useState<"draw" | "upload">("draw");

  // Draw state
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<StrokePoint[]>([]);
  const [penColor, setPenColor] = useState<string>("#000000");
  const [strokeWidth, setStrokeWidth] = useState<number>(3);

  // Upload state
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [removeBg, setRemoveBg] = useState<boolean>(true);

  // Redraw canvas whenever strokes or current stroke change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw previous strokes
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }

    // Draw in-progress stroke
    if (currentStroke.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = penColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(currentStroke[0].x, currentStroke[0].y);
      for (let i = 1; i < currentStroke.length; i++) {
        ctx.lineTo(currentStroke[i].x, currentStroke[i].y);
      }
      ctx.stroke();
    }
  }, [strokes, currentStroke, penColor, strokeWidth]);

  if (!isSignatureModalOpen) return null;

  function getCanvasCoords(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    setIsDrawing(true);
    const coords = getCanvasCoords(e);
    setCurrentStroke([coords]);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const coords = getCanvasCoords(e);
    setCurrentStroke((prev) => [...prev, coords]);
  }

  function handleMouseUp() {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentStroke.length > 1) {
      setStrokes((prev) => [
        ...prev,
        {
          points: currentStroke,
          color: penColor,
          width: strokeWidth,
        },
      ]);
    }
    setCurrentStroke([]);
  }

  function handleClear() {
    setStrokes([]);
    setCurrentStroke([]);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function handleUndo() {
    setStrokes((prev) => prev.slice(0, prev.length - 1));
  }

  async function handleSelectImage() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (!selected || typeof selected !== "string") return;

      const fileBytes = await readFile(selected);
      const name = selected.split(/[/\\]/).pop() || "signature.png";
      setUploadedFileName(name);

      const mimeType = name.toLowerCase().endsWith(".png")
        ? "image/png"
        : "image/jpeg";
      const blob = new Blob([fileBytes], { type: mimeType });

      const reader = new FileReader();
      reader.onload = () => {
        const rawUrl = reader.result as string;

        if (removeBg) {
          // Process white background removal via an offscreen canvas
          const img = new Image();
          img.onload = () => {
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const tempCtx = tempCanvas.getContext("2d");
            if (!tempCtx) {
              setUploadedDataUrl(rawUrl);
              return;
            }

            tempCtx.drawImage(img, 0, 0);
            const imgData = tempCtx.getImageData(0, 0, img.width, img.height);
            const data = imgData.data;

            // Make white or near-white pixels transparent
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              if (r > 230 && g > 230 && b > 230) {
                data[i + 3] = 0;
              }
            }

            tempCtx.putImageData(imgData, 0, 0);
            setUploadedDataUrl(tempCanvas.toDataURL("image/png"));
          };
          img.src = rawUrl;
        } else {
          setUploadedDataUrl(rawUrl);
        }
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error("Failed to upload signature image:", err);
    }
  }

  function handleInsertSignature() {
    if (!activeTab) return;

    let finalDataUrl: string | null = null;

    if (activeTabMode === "draw") {
      const canvas = canvasRef.current;
      if (!canvas || strokes.length === 0) return;
      finalDataUrl = canvas.toDataURL("image/png");
    } else {
      if (!uploadedDataUrl) return;
      finalDataUrl = uploadedDataUrl;
    }

    if (!finalDataUrl) return;

    // Create a new signature annotation placed on current page
    const newSignature: SignatureAnnotation = {
      id: `signature-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      page: activeTab.currentPage,
      type: "signature",
      imageDataUrl: finalDataUrl,
      x: 0.35,
      y: 0.45,
      width: 0.28,
      height: 0.09,
    };

    addAnnotation(activeTab.id, newSignature);
    setActiveTool("select");
    closeSignatureModal();
  }

  const hasDrawableContent = strokes.length > 0;
  const canInsert =
    activeTabMode === "draw" ? hasDrawableContent : !!uploadedDataUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-lg rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl overflow-hidden text-neutral-100 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-950/40">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30">
              <FileSignature className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight">
                Create E-Signature
              </h2>
              <p className="text-xs text-neutral-400">
                Draw or upload a signature to place on the document
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeSignatureModal}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex items-center gap-2 px-6 pt-4 border-b border-neutral-800 bg-neutral-950/20">
          <button
            type="button"
            onClick={() => setActiveTabMode("draw")}
            className={`flex items-center gap-2 pb-3 px-1 text-xs font-medium border-b-2 transition cursor-pointer ${
              activeTabMode === "draw"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <PenTool className="h-3.5 w-3.5" />
            <span>Draw Signature</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTabMode("upload")}
            className={`flex items-center gap-2 pb-3 px-1 text-xs font-medium border-b-2 transition cursor-pointer ${
              activeTabMode === "upload"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Upload Image</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-4">
          {activeTabMode === "draw" ? (
            <>
              {/* Drawing Canvas */}
              <div className="relative rounded-xl border border-neutral-800 bg-white overflow-hidden shadow-inner cursor-crosshair">
                <canvas
                  ref={canvasRef}
                  width={560}
                  height={200}
                  className="w-full h-48 block"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
                {!hasDrawableContent && !isDrawing && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-neutral-400 text-xs font-medium">
                    Draw your signature here with your mouse or stylus
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between">
                {/* Color swatches */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-neutral-400 mr-1">Ink:</span>
                  {[
                    { color: "#000000", label: "Black" },
                    { color: "#1e3a8a", label: "Navy" },
                    { color: "#2563eb", label: "Blue" },
                    { color: "#b91c1c", label: "Red" },
                  ].map((c) => (
                    <button
                      key={c.color}
                      type="button"
                      onClick={() => setPenColor(c.color)}
                      style={{ backgroundColor: c.color }}
                      className={`h-5 w-5 rounded-full border cursor-pointer transition ${
                        penColor === c.color
                          ? "border-white ring-2 ring-blue-500 scale-110"
                          : "border-neutral-700 hover:scale-105"
                      }`}
                      title={c.label}
                    />
                  ))}

                  <div className="h-4 w-[1px] bg-neutral-800 mx-2" />

                  {/* Stroke Width Selector */}
                  {[
                    { width: 2, label: "Fine" },
                    { width: 3, label: "Medium" },
                    { width: 5, label: "Bold" },
                  ].map((w) => (
                    <button
                      key={w.width}
                      type="button"
                      onClick={() => setStrokeWidth(w.width)}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                        strokeWidth === w.width
                          ? "bg-blue-600 text-white"
                          : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>

                {/* Undo & Clear */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={strokes.length === 0}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 disabled:opacity-30 cursor-pointer"
                    title="Undo Last Stroke"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={strokes.length === 0}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-neutral-800 disabled:opacity-30 cursor-pointer"
                    title="Clear Signature"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Upload Section */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleSelectImage}
                    className="inline-flex items-center gap-2 rounded-xl bg-neutral-800 border border-neutral-700 px-4 py-2.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 hover:text-white cursor-pointer"
                  >
                    <Upload className="h-4 w-4 text-blue-400" />
                    <span>Choose Signature Image...</span>
                  </button>

                  <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={removeBg}
                      onChange={(e) => setRemoveBg(e.target.checked)}
                      className="rounded accent-blue-500 h-4 w-4"
                    />
                    <span>Remove white background</span>
                  </label>
                </div>

                {/* Preview Box */}
                <div className="h-48 rounded-xl border border-neutral-800 bg-neutral-950 flex items-center justify-center overflow-hidden p-4">
                  {uploadedDataUrl ? (
                    <img
                      src={uploadedDataUrl}
                      alt="Uploaded Signature"
                      className="max-h-full max-w-full object-contain filter drop-shadow-md"
                    />
                  ) : (
                    <span className="text-xs text-neutral-500">
                      Select a PNG or JPEG file with your signature
                    </span>
                  )}
                </div>

                {uploadedFileName && (
                  <span className="text-[11px] font-mono text-neutral-400 truncate">
                    Loaded: {uploadedFileName}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-800 bg-neutral-950/40">
          <button
            type="button"
            onClick={closeSignatureModal}
            className="rounded-xl px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleInsertSignature}
            disabled={!canInsert}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 cursor-pointer"
          >
            <Check className="h-4 w-4" />
            <span>Place Signature on Page {activeTab?.currentPage || 1}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
