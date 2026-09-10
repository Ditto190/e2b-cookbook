import { Button } from '@/components/ui/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { fetchFile, fetchFiles, getClientId, uploadFiles } from '@/api/client'
import { FileList } from '@/components/file-list'
import { FilePreview } from '@/components/file-preview'
import { cn } from '@/lib/utils'
import { Loader } from '@/components/ui/loader'
import { LogViewer } from '@/components/log-viewer'
import { ArrowLeftIcon, HistoryIcon, UploadIcon } from '@/ui/primitives/icons'

const clientId = getClientId()

type WorkspacePaneState = {
  selectedPath: string | null
  showLogs: boolean
}

const defaultWorkspacePaneState: WorkspacePaneState = {
  selectedPath: null,
  showLogs: false,
}

function workspacePaneKey(chatId: string) {
  return ['workspace-pane', chatId] as const
}

/** Bottom-of-pane drop zone: drag files in (or click to browse) and they land
 * in the sandbox /workspace via POST /api/upload. Any file type — the backend
 * only enforces the 100 MB per-request cap. */
function UploadDropZone({
  connected,
  chatId,
}: {
  connected: boolean
  chatId: string
}) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  // Counter, not boolean: dragenter/dragleave fire per child element.
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  // 0..1 upload fraction; 1 means "bytes sent, sandbox still writing".
  const [progress, setProgress] = useState(0)

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      setProgress(0)
      return uploadFiles(clientId, chatId, files, setProgress)
    },
    // Re-uploading a file overwrites it in the sandbox (files.write
    // truncates), so refresh the previews too — prefix-matching
    // ['file', chatId] catches whichever file is open in the viewer.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', chatId] })
      queryClient.invalidateQueries({ queryKey: ['file', chatId] })
    },
  })

  const submit = (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (files.length > 0 && connected && !upload.isPending) {
      upload.mutate(files)
    }
  }

  return (
    <div className="shrink-0 p-2">
      <button
        className={cn(
          // min-h mirrors the composer card's resting height next door
          // (textarea clamp + tools row), so the drop target spans the same
          // band as the input zone instead of a thin strip at the bottom.
          // relative + overflow-hidden anchor the upload progress rail.
          'relative flex min-h-[clamp(6rem,24vw,9.25rem)] w-full items-center justify-center gap-2 overflow-hidden border border-stroke border-dashed px-3 py-2.5 font-mono text-[11px] transition-colors',
          connected
            ? 'cursor-pointer text-fg-tertiary hover:bg-bg-highlight hover:text-fg'
            : 'cursor-default text-fg-tertiary opacity-50',
          dragging && 'border-solid bg-bg-highlight text-fg'
        )}
        disabled={!connected || upload.isPending}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragLeave={() => {
          dragDepth.current -= 1
          if (dragDepth.current <= 0) {
            dragDepth.current = 0
            setDragging(false)
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          submit(event.dataTransfer.files)
        }}
        type="button"
      >
        {upload.isPending && (
          // Progress rail just inside the dashed top border — inset-x-2/top-2
          // keep an 8px gap to the dashes on all three sides. The outer span
          // is the full-width track (so the inner width % measures the inset
          // run, not the whole button); primary orange fill tracks bytes sent
          // (the tail past 100% is the sandbox write).
          <span aria-hidden className="absolute inset-x-2 top-2 h-0.5">
            <span
              className="block h-full bg-accent-main-highlight transition-[width] duration-200 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </span>
        )}
        {upload.isPending ? (
          <>
            <Loader className="shrink-0 text-xs" />
            <span>
              {progress < 1
                ? `Uploading… ${Math.round(progress * 100)}%`
                : 'Writing to sandbox…'}
            </span>
          </>
        ) : (
          <>
            <UploadIcon className="size-3.5 shrink-0" />
            <span>
              {connected
                ? 'Drop files here or click to upload'
                : 'Uploads need a live sandbox'}
            </span>
          </>
        )}
      </button>
      {upload.isError && (
        <p className="truncate px-1 pt-1 font-mono text-[11px] text-accent-error-highlight">
          {upload.error.message}
        </p>
      )}
      <input
        className="hidden"
        multiple
        onChange={(event) => {
          submit(event.target.files)
          event.target.value = ''
        }}
        ref={inputRef}
        type="file"
      />
    </div>
  )
}

export function WorkspacePane({
  connected,
  active,
  chatId,
  logsAvailable,
  className,
}: {
  connected: boolean
  active: boolean
  chatId: string
  logsAvailable: boolean
  className?: string
}) {
  const queryClient = useQueryClient()
  const paneKey = workspacePaneKey(chatId)
  const paneStateQuery = useQuery({
    queryKey: paneKey,
    queryFn: () => Promise.resolve(defaultWorkspacePaneState),
    enabled: false,
    initialData: defaultWorkspacePaneState,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const { selectedPath, showLogs } = paneStateQuery.data
  const setPaneState = (
    update: (state: WorkspacePaneState) => WorkspacePaneState
  ) => {
    queryClient.setQueryData<WorkspacePaneState>(paneKey, (state) =>
      update(state ?? defaultWorkspacePaneState)
    )
  }

  const filesQuery = useQuery({
    queryKey: ['files', chatId],
    queryFn: () => fetchFiles(clientId, chatId),
    enabled: connected,
    refetchInterval: active ? 4000 : false,
  })

  const fileQuery = useQuery({
    queryKey: ['file', chatId, selectedPath],
    queryFn: () => fetchFile(clientId, chatId, selectedPath ?? ''),
    enabled: connected && selectedPath !== null,
  })

  // No useMemo — the compiler keeps the fallback [] stable for FileList.
  const entries = filesQuery.data?.files ?? []

  return (
    <section
      className={cn(
        // A real border, not shadow-card: the panel wrapper clips overflow at
        // the pane's exact width, so an outside-the-box shadow ring loses its
        // left/top/bottom edges. A border draws inside the box and survives.
        'min-w-0 flex-col overflow-hidden border border-stroke bg-bg',
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-stroke border-b px-3">
        <span className="min-w-0 truncate font-mono text-[13px] text-fg-secondary">
          {showLogs ? 'runtime logs' : selectedPath ?? filesQuery.data?.workspace ?? '/workspace'}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-pressed={showLogs}
            className={cn(
              showLogs
                ? 'bg-fill-highlight/40 text-fg [&_svg]:text-fg'
                : 'text-fg-tertiary [&_svg]:text-fg-tertiary'
            )}
            onClick={() =>
              setPaneState((state) => ({
                ...state,
                showLogs: !state.showLogs,
              }))
            }
            size="icon-sm"
            title={showLogs ? 'Show workspace files' : 'Show runtime logs'}
            variant="quaternary"
          >
            <HistoryIcon />
            <span className="sr-only">Toggle runtime logs</span>
          </Button>
          {/* No manual refresh — files poll while a turn is active. */}
          {!showLogs && selectedPath && (
            <Button
              aria-label="Back to the file list"
              className="shrink-0"
              onClick={() =>
                setPaneState((state) => ({ ...state, selectedPath: null }))
              }
              size="icon-sm"
              variant="secondary"
            >
              <ArrowLeftIcon />
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {showLogs ? (
          <LogViewer available={logsAvailable} chatId={chatId} />
        ) : selectedPath ? (
          <FilePreview
            content={fileQuery.data?.content}
            encoding={fileQuery.data?.encoding}
            error={fileQuery.error}
            loading={fileQuery.isLoading}
            mime={fileQuery.data?.mime}
            path={selectedPath}
          />
        ) : (
          <FileList
            connected={connected}
            entries={entries}
            loading={filesQuery.isLoading && connected}
            onSelect={(path) =>
              setPaneState((state) => ({ ...state, selectedPath: path }))
            }
          />
        )}
      </div>
      {!showLogs && <UploadDropZone chatId={chatId} connected={connected} />}
    </section>
  )
}
