export type SaveResult = 'saved' | 'cancelled' | 'needs-tap';

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Opens the iOS share sheet, or downloads where sharing files is unavailable.
 * Safari only allows sharing right after a tap, so after slow preparation it
 * answers `needs-tap` and the caller offers one more button.
 */
export async function saveFile(file: File): Promise<SaveResult> {
  if (!navigator.canShare?.({ files: [file] })) {
    download(file);
    return 'saved';
  }
  try {
    await navigator.share({ files: [file] });
    return 'saved';
  } catch (error) {
    const name = (error as DOMException).name;
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') return 'needs-tap';
    throw error;
  }
}
