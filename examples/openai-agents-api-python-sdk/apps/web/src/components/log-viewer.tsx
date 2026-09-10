import { getClientId, streamLogs } from '@/api/client'
import { Button } from '@/components/ui/button'
import { appendLog, clearLogs, useLogs } from '@/lib/log-store'
import { cn } from '@/lib/utils'
import {
  ArrowDownIcon,
  CheckmarkIcon,
  CopyIcon,
  RemoveIcon,
  TerminalIcon,
} from '@/ui/primitives/icons'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'

const clientId = getClientId()
const logTime = new Intl.DateTimeFormat([], {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function LogViewer({
  chatId,
  available,
}: {
  chatId: string
  available: boolean
}) {
  const records = useLogs(chatId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const copyResetTimer = useRef<number>(undefined)
  const [following, setFollowing] = useState(true)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 18,
    getItemKey: (index) => records[index]?.seq ?? index,
  })

  useEffect(() => {
    if (!available) return
    const abort = new AbortController()
    setNotice(null)
    setError(null)
    ;(async () => {
      try {
        for await (const item of streamLogs(clientId, chatId, abort.signal)) {
          if (item.type === 'log') appendLog(chatId, item)
          else if (item.type === 'gap') {
            setNotice('Some earlier logs are unavailable.')
          }
        }
      } catch (reason) {
        if (!abort.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Log stream failed.')
        }
      }
    })()
    return () => abort.abort()
  }, [available, chatId])

  const latestRecord = records.at(-1)
  useEffect(() => {
    if (following && records.length > 0) {
      virtualizer.scrollToIndex(records.length - 1, { align: 'end' })
    }
  }, [following, latestRecord, records.length])

  const copyLogs = () => {
    const text = records
      .map((record) => {
        const time = logTime.format(new Date(record.at))
        const source =
          record.source === 'agents_command' ? 'command' : record.source
        return `${time} ${source} ${record.text}`
      })
      .join('\n')

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.clearTimeout(copyResetTimer.current)
      copyResetTimer.current = window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-1">
      <div className="flex h-9 shrink-0 items-center justify-between border-stroke border-b px-2">
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-fg-tertiary uppercase tracking-[0.12em]">
          <TerminalIcon className="size-3.5" />
          <span>{records.length.toLocaleString()} lines</span>
          {notice && <span className="truncate">· {notice}</span>}
          {error && <span className="truncate text-accent-error-highlight">· {error}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            disabled={records.length === 0}
            onClick={copyLogs}
            size="icon-xs"
            title={copied ? 'Logs copied' : 'Copy all logs'}
            variant="quaternary"
          >
            {copied ? <CheckmarkIcon /> : <CopyIcon />}
          </Button>
          <Button
            aria-pressed={following}
            className={cn(
              following && 'bg-fill-highlight/40 text-fg [&_svg]:text-fg'
            )}
            onClick={() => {
              const next = !following
              followRef.current = next
              setFollowing(next)
            }}
            size="icon-xs"
            title={following ? 'Stop following logs' : 'Follow latest logs'}
            variant="quaternary"
          >
            <ArrowDownIcon />
          </Button>
          <Button
            onClick={() => clearLogs(chatId)}
            size="icon-xs"
            title="Clear visible logs"
            variant="quaternary"
          >
            <RemoveIcon />
          </Button>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-[22px]"
        onScroll={(event) => {
          const node = event.currentTarget
          const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 40
          if (followRef.current !== atBottom) {
            followRef.current = atBottom
            setFollowing(atBottom)
          }
        }}
        ref={scrollRef}
      >
        {records.length === 0 ? (
          <div className="flex h-full items-center justify-center px-5 text-center text-fg-tertiary">
            {available
              ? 'Runtime output appears here while agent runs commands.'
              : 'Logs appear after first turn creates a session.'}
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const record = records[row.index]
              if (!record) return null
              const time = logTime.format(new Date(record.at))
              return (
                <div
                  className="absolute left-0 top-0 flex w-max min-w-full border-stroke/40 border-b px-2 hover:bg-bg-highlight"
                  key={record.seq}
                  style={{
                    height: row.size,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <span className="w-16 shrink-0 select-none text-fg-tertiary/70">
                    {time}
                  </span>
                  <span
                    className={cn(
                      'w-20 shrink-0 select-none truncate uppercase',
                      record.source === 'backend' && 'text-fg-tertiary',
                      record.source === 'executor' && 'text-accent-info-highlight',
                      record.source === 'agents_command' && 'text-accent-main-highlight'
                    )}
                  >
                    {record.source === 'agents_command' ? 'command' : record.source}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 whitespace-pre text-fg-secondary',
                      (record.stream === 'stderr' ||
                        (record.source === 'backend' && record.text.includes(' failed ('))) &&
                        'text-accent-error-highlight'
                    )}
                    title={record.text}
                  >
                    {record.text || ' '}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
