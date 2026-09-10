import { Markdown } from '@/components/markdown'
import { Skeleton } from '@/components/ui/skeleton'

// Extension → shiki language for the code-block preview. Anything missing
// falls back to a plain "text" block — still gets the header + copy chrome.
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  jsx: 'jsx',
  json: 'json',
  jsonl: 'json',
  html: 'html',
  css: 'css',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  rb: 'ruby',
  php: 'php',
  xml: 'xml',
  swift: 'swift',
  kt: 'kotlin',
}

const BACKTICK_RUN = /`+/g

/** Wrap raw file content in a markdown fence long enough that backtick runs
 * inside the file can't terminate it early. */
function fenced(content: string, language: string): string {
  let longest = 0
  for (const run of content.match(BACKTICK_RUN) ?? []) {
    longest = Math.max(longest, run.length)
  }
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${language}\n${content}\n${fence}`
}

export function FilePreview({
  path,
  content,
  encoding,
  mime,
  loading,
  error,
}: {
  path: string
  content: string | undefined
  encoding?: 'utf-8' | 'base64'
  mime?: string
  loading: boolean
  error: unknown
}) {
  if (loading) {
    return (
      <div className="space-y-2 px-3 pb-3 pt-6">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }
  if (error) {
    return (
      <p className="px-3 pb-3 pt-6 font-mono text-[11px] text-accent-error-highlight">
        {error instanceof Error ? error.message : 'Could not load the file.'}
      </p>
    )
  }
  // Images and videos arrive base64 in the JSON envelope (the API is
  // header-authed, so an <img>/<video> src pointing at the endpoint can't
  // work) — render a data URI.
  if (encoding === 'base64' && mime && content !== undefined) {
    const src = `data:${mime};base64,${content}`
    return (
      // p-3 matches the pane header's px-3, so media lines up with the
      // path label and back button above.
      <div className="p-3">
        {mime.startsWith('video/') ? (
          <video
            className="max-w-full border border-stroke"
            controls
            src={src}
          />
        ) : (
          <img
            alt="Workspace file preview"
            className="max-w-full border border-stroke"
            src={src}
          />
        )}
      </div>
    )
  }
  if (content === undefined) return null
  // Text files get the transcript's markdown treatment: .md renders as
  // markdown, everything else as a shiki-highlighted code block with the
  // same header/copy/download chrome as streamed replies.
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  const isMarkdown = extension === 'md' || extension === 'markdown'
  return (
    // p-3 matches the pane header's px-3, so the code block's left edge
    // lines up with the path label and back button above.
    <div className="p-3 text-[13px] leading-[1.65]">
      <Markdown>
        {isMarkdown
          ? content
          : fenced(content, LANGUAGE_BY_EXTENSION[extension] ?? 'text')}
      </Markdown>
    </div>
  )
}
