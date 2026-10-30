"use client";
import { useExtensionVersion } from "@/components/ExtensionConnect";
import { EXTENSION_DOWNLOAD_URL, LATEST_EXTENSION, isOlder } from "@/lib/extension-version";

/** Shown on signed-in pages when the installed Chrome extension is older than the app expects. */
export default function ExtensionUpdateBanner() {
  const version = useExtensionVersion();
  if (!version || !isOlder(version, LATEST_EXTENSION)) return null;
  return (
    <div className="mx-auto max-w-6xl px-4 pt-4">
      <div className="rounded-[20px] bg-amber-soft px-5 py-4 text-sm flex flex-wrap items-center justify-between gap-3">
        <p>
          <b>Update your Chrome extension</b> (you have {version}, latest is {LATEST_EXTENSION}). Some features won&apos;t
          work until you do. Download, unzip, replace your <code>extension</code> folder with the new one, then click
          reload on <code>chrome://extensions</code>.
        </p>
        <a className="btn-primary py-1.5" href={EXTENSION_DOWNLOAD_URL}>Download latest</a>
      </div>
    </div>
  );
}
