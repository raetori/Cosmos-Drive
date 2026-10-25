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
    return await w.showDirectoryPicker!({ id: 'cosmodrive', mode: 'readwrite' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

type HandleItem = DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> }
type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>
}

/** Folders dragged in from Finder or File Explorer can be written to (Chromium only). */
export const canDropFolder = typeof DataTransferItem !== 'undefined' && 'getAsFileSystemHandle' in DataTransferItem.prototype

/** True while something dragged over the page comes from the computer rather than the page itself. */
export const draggingFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes('Files')

/**
 * The folder dropped in a drop event. Must be called synchronously inside the handler: the browser
 * clears the items afterwards. Rejects if Chrome won't hand over that folder (e.g. Downloads itself).
 */
export async function droppedFolder(dt: DataTransfer): Promise<FileSystemDirectoryHandle | 'file' | null> {
  const item = Array.from(dt.items).find((i) => i.kind === 'file') as HandleItem | undefined
  const handle = await item?.getAsFileSystemHandle?.()
  if (!handle) return null
  return handle.kind === 'directory' ? (handle as FileSystemDirectoryHandle) : 'file'
}

/**
 * Asks for permission to write into a dropped folder (a picked one already has it). Chrome only shows
 * the prompt right after a click or key press, so this can throw after a drop: retry it from a button.
 */
export async function allowWrite(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const h = dir as PermissionHandle
  const mode = { mode: 'readwrite' as const }
  if (!h.requestPermission || (await h.queryPermission?.(mode)) === 'granted') return true
  return (await h.requestPermission(mode)) === 'granted'
}

/**
 * Where a zip will be written. With a save dialog the zip streams straight to disk;
 * otherwise it is collected in memory and handed to the browser's downloads when done.
 */
export async function zipDestination(name: string): Promise<WritableStream<Uint8Array> | null> {
  if (canSaveFile) {
    try {
      const handle = await w.showSaveFilePicker!({
        id: 'cosmodrive-zip',
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
