import { useRef, useState, type DragEvent } from 'react'
import { allowWrite, canDropFolder, draggingFiles, droppedFolder, pickFolder } from '../lib/pickers'
import { Modal } from './Dialogs'
import { CopyDown, ShieldCheck } from './Icons'

export type FolderPurpose = 'copy' | 'check'

interface Props {
  purpose: FolderPurpose
  label: string
  /** A folder dropped on the browser whose write permission still needs a click. */
  pending?: FileSystemDirectoryHandle
  onChosen(dir: FileSystemDirectoryHandle): void
  onClose(): void
}

/**
 * Where a copy goes (or where an earlier copy lives): drag a folder in, or choose one. Chrome refuses
 * Downloads, Desktop, Documents, the home folder and a drive's top level, and we can't catch its
 * dialog, so we say so up front.
 */
export function FolderTargetDialog({ purpose, label, pending: initial, onChosen, onClose }: Props) {
  const [over, setOver] = useState(false)
  const [pending, setPending] = useState<FileSystemDirectoryHandle | undefined>(initial)
  const [error, setError] = useState('')
  const depth = useRef(0)

  const use = async (dir: FileSystemDirectoryHandle) => {
    setError('')
    try {
      if (await allowWrite(dir)) return onChosen(dir)
      setPending(undefined)
      setError(`CosmoDrive needs permission to save into “${dir.name}”. Drag it in again and choose Allow.`)
    } catch {
      // Chrome wants a fresh click before it asks: offer one.
      setPending(dir)
    }
  }

  const choose = async () => {
    setError('')
    try {
      const dir = await pickFolder()
      if (dir) onChosen(dir)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setOver(false)
    droppedFolder(e.dataTransfer).then(
      (dir) => {
        if (dir === 'file') setError('That’s a file. Drag a folder instead.')
        else if (dir) void use(dir)
      },
      () => setError('Chrome won’t let websites use that folder. Make a new folder inside it and drag that in instead.'),
    )
  }

  const copy = purpose === 'copy'
  return (
    <Modal title={copy ? `Copy “${label}” to…` : `Check a copy of “${label}”`} onClose={onClose}>
      <div className="form">
        {pending ? (
          <div className="dropzone ready">
            <CopyDown width={26} height={26} />
            <strong>{pending.name}</strong>
            <span>One more click so Chrome lets CosmoDrive save into this folder.</span>
            <button className="btn primary" onClick={() => void use(pending)}>
              Allow and {copy ? 'start copying' : 'check'}
            </button>
          </div>
        ) : (
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onDragEnter={(e) => {
              if (!draggingFiles(e.dataTransfer)) return
              depth.current++
              setOver(true)
            }}
            onDragLeave={() => {
              if (--depth.current <= 0) setOver(false)
            }}
            onDragOver={(e) => {
              if (!draggingFiles(e.dataTransfer)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={onDrop}
          >
            {copy ? <CopyDown width={26} height={26} /> : <ShieldCheck width={26} height={26} />}
            {canDropFolder && (
              <>
                <strong>{copy ? 'Drag a folder here' : 'Drag your copy here'}</strong>
                <span>from Finder or File Explorer</span>
                <span className="or">or</span>
              </>
            )}
            <button className="btn primary" onClick={() => void choose()}>
              Choose a folder…
            </button>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <small>
          {copy ? 'Pick or make a folder for it' : 'Pick the folder that holds the copy'}, for example <em>8TB_My Book › CosmoDrive Downloads</em>.
          Chrome won&rsquo;t let websites use Downloads, Desktop, Documents, your home folder or the top level of a drive themselves, so
          use a folder inside them. The picker&rsquo;s New Folder button makes one.
        </small>
      </div>
    </Modal>
  )
}
