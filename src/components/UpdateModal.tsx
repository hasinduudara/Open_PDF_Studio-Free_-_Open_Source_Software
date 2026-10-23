import {
  Sparkles,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  RefreshCw,
  ArrowRight,
  Calendar,
  FileText,
} from "lucide-react";
import { usePdfStore } from "../store/usePdfStore";
import {
  checkForAppUpdates,
  installCurrentUpdate,
  dismissUpdate,
} from "../utils/updateManager";

/**
 * In-app update modal dialog.
 * Handles checking status, displaying update details/release notes,
 * download progress bar, and initiating relaunch upon installation.
 */
export default function UpdateModal() {
  const {
    isUpdateModalOpen,
    updateInfo,
    isCheckingUpdate,
    updateCheckManual,
    isUpToDate,
    updateError,
    downloadProgress,
    isDownloading,
    updateStatusText,
    closeUpdateModal,
  } = usePdfStore();

  if (!isUpdateModalOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-lg flex flex-col rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl overflow-hidden text-neutral-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4 bg-neutral-950/50">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-600/10 text-red-400 ring-1 ring-red-500/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">
                Software Update
              </h3>
              <p className="text-[11px] text-neutral-400">
                Open PDF Studio Updater
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={dismissUpdate}
            disabled={isDownloading}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors disabled:opacity-30 cursor-pointer"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {/* State 1: Checking for updates */}
          {isCheckingUpdate && updateCheckManual && (
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800 text-amber-400 ring-1 ring-neutral-700 shadow-inner">
                <Loader2 className="h-7 w-7 animate-spin" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-white">
                  Checking for updates...
                </h4>
                <p className="text-xs text-neutral-400">
                  Contacting release servers for new versions of Open PDF Studio.
                </p>
              </div>
            </div>
          )}

          {/* State 2: You're up to date */}
          {!isCheckingUpdate && isUpToDate && (
            <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 shadow-inner">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-base font-semibold text-white">
                  You're Up to Date!
                </h4>
                <p className="text-xs text-neutral-400 max-w-xs leading-relaxed">
                  Open PDF Studio is currently running the newest release. No newer versions were found.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={closeUpdateModal}
                  className="rounded-xl bg-neutral-800 px-6 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-700 hover:text-white transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* State 3: Error checking or downloading */}
          {!isCheckingUpdate && updateError && (
            <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-400 ring-1 ring-red-500/20 shadow-inner">
                <AlertCircle className="h-7 w-7" />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-base font-semibold text-white">
                  Update Check Failed
                </h4>
                <p className="text-xs text-red-400 max-w-sm leading-relaxed">
                  {updateError}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => checkForAppUpdates(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 active:bg-red-700 transition cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Try Again</span>
                </button>
                <button
                  type="button"
                  onClick={closeUpdateModal}
                  className="rounded-xl bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* State 4: Update Available */}
          {!isCheckingUpdate && !isUpToDate && !updateError && updateInfo && (
            <div className="space-y-5">
              {/* Version Comparison Card */}
              <div className="flex items-center justify-between rounded-xl bg-neutral-950/70 border border-neutral-800 p-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Installed Version
                  </span>
                  <div className="text-xs font-mono font-medium text-neutral-300">
                    v{updateInfo.currentVersion}
                  </div>
                </div>

                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-neutral-400">
                  <ArrowRight className="h-4 w-4" />
                </div>

                <div className="space-y-1 text-right">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    New Version
                  </span>
                  <div className="text-xs font-mono font-bold text-emerald-400">
                    v{updateInfo.version}
                  </div>
                </div>
              </div>

              {/* Release Date */}
              {updateInfo.date && (
                <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>
                    Released on {new Date(updateInfo.date).toLocaleDateString()}
                  </span>
                </div>
              )}

              {/* Release Notes */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
                  <FileText className="h-3.5 w-3.5 text-neutral-400" />
                  <span>What's New in this Release:</span>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950/50 p-3.5 text-xs text-neutral-300 leading-relaxed font-sans whitespace-pre-wrap">
                  {updateInfo.body?.trim() || "Performance improvements, security enhancements, and bug fixes."}
                </div>
              </div>

              {/* Download Progress Bar */}
              {isDownloading && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-neutral-300">
                      {updateStatusText || "Downloading update..."}
                    </span>
                    <span className="font-mono text-emerald-400">
                      {downloadProgress !== null ? `${downloadProgress}%` : ""}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full bg-gradient-to-r from-red-600 via-amber-500 to-emerald-500 transition-all duration-300 ease-out"
                      style={{
                        width: downloadProgress !== null ? `${downloadProgress}%` : "100%",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800/80">
                {!isDownloading && (
                  <button
                    type="button"
                    onClick={dismissUpdate}
                    className="rounded-xl border border-neutral-700 bg-neutral-800/60 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors cursor-pointer"
                  >
                    Later
                  </button>
                )}

                <button
                  type="button"
                  onClick={installCurrentUpdate}
                  disabled={isDownloading}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-red-500 active:bg-red-700 disabled:opacity-50 cursor-pointer"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Installing Update...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <span>Update & Restart Now</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
