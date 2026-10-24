// Thin wrappers over the File System Access API (Chrome, Edge, Opera, Arc, Brave on desktop).

interface PickerWindow {
  showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  showSaveFilePicker?: (opts?: {
    id?: string
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle>
}

const w = window as unknown as PickerWindow

export const canPickFolder = typeof w.showDirectoryPicker === 'function'
export const canSaveFile = typeof w.showSaveFilePicker === 'function'

/** Returns null if the user closed the dialog. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await w.showDirectoryPicker!({ id: 'cosmos-drive', mode: 'readwrite' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

/**
 * Where a zip will be written. With a save dialog the zip streams straight to disk;
 * otherwise it is collected in memory and handed to the browser's downloads when done.
 */
export async function zipDestination(name: string): Promise<WritableStream<Uint8Array> | null> {
  if (canSaveFile) {
    try {
      const handle = await w.showSaveFilePicker!({
        id: 'cosmos-drive-zip',
        suggestedName: name,
        types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }],
      })
      return await handle.createWritable()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null
      throw e
    }
  }
  const parts: Uint8Array[] = []
  return new WritableStream<Uint8Array>({
    write(chunk) {
      parts.push(chunk)
    },
    close() {
      const url = URL.createObjectURL(new Blob(parts as BlobPart[], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
  })
}
