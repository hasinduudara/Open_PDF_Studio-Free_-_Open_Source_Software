import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { usePdfStore } from "../store/usePdfStore";

let activeUpdateInstance: Update | null = null;

/**
 * Checks for application updates via Tauri updater plugin.
 *
 * @param manual If true, indicates a user-initiated check where status (up-to-date or error) is explicitly displayed.
 */
export async function checkForAppUpdates(manual: boolean = false): Promise<void> {
  const store = usePdfStore.getState();
  store.setCheckingUpdate(true, manual);

  try {
    const update = await check();

    if (update) {
      if (activeUpdateInstance && activeUpdateInstance !== update) {
        try {
          await activeUpdateInstance.close();
        } catch {
          // Ignored
        }
      }
      activeUpdateInstance = update;

      store.setUpdateAvailable({
        version: update.version,
        currentVersion: update.currentVersion,
        body: update.body,
        date: update.date,
      });
    } else {
      if (manual) {
        store.setUpToDate();
      } else {
        store.setCheckingUpdate(false, false);
      }
    }
  } catch (error: any) {
    console.warn("Update check failed:", error);
    if (manual) {
      store.setUpdateError(
        error?.message || "Failed to check for updates. Please verify your internet connection."
      );
    } else {
      store.setCheckingUpdate(false, false);
    }
  }
}

/**
 * Downloads and installs the pending update package, then relaunches the application.
 */
export async function installCurrentUpdate(): Promise<void> {
  if (!activeUpdateInstance) return;

  const store = usePdfStore.getState();
  store.setIsDownloading(true);
  store.setDownloadProgress(0, "Initializing download...");

  try {
    let totalBytes = 0;
    let downloadedBytes = 0;

    await activeUpdateInstance.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength || 0;
        store.setDownloadProgress(
          0,
          totalBytes > 0 ? "Downloading update (0%)..." : "Downloading update..."
        );
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        if (totalBytes > 0) {
          const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          store.setDownloadProgress(percent, `Downloading update (${percent}%)...`);
        } else {
          const mb = (downloadedBytes / (1024 * 1024)).toFixed(1);
          store.setDownloadProgress(null, `Downloaded ${mb} MB...`);
        }
      } else if (event.event === "Finished") {
        store.setDownloadProgress(100, "Download complete. Installing update...");
      }
    });

    store.setDownloadProgress(100, "Restarting Open PDF Studio...");
    // Give Windows a brief moment to finalize installer launch before restarting
    await new Promise((resolve) => setTimeout(resolve, 600));
    await relaunch();
  } catch (error: any) {
    console.error("Failed to install update:", error);
    store.setIsDownloading(false);
    store.setUpdateError(error?.message || "Failed to download and install update.");
  }
}

/**
 * Closes the update modal and releases update resources if needed.
 */
export async function dismissUpdate(): Promise<void> {
  const store = usePdfStore.getState();
  store.closeUpdateModal();
}
