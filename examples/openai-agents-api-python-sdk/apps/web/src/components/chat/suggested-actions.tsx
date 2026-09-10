// Card label and the prompt it sends. Most read the same; the MCP check
// shows a short title over a multi-step prompt.
const SUGGESTIONS: { title: string; prompt: string }[] = [
  { title: 'List the files in /workspace and describe what you see',
    prompt: 'List the files in /workspace and describe what you see' },
  { title: 'Write a hello-world Python script and run it',
    prompt: 'Write a hello-world Python script and run it' },
  {
    title: 'Test the four connected MCPs with live tool calls',
    prompt: `Test the four connected MCPs with real, individual tool calls in this chat. First acknowledge Hacker News, Context7, DeepWiki, and OpenAI Docs. Use tool search to discover tools as needed. Do not delegate, use web search, browse, run shell or HTTP requests, or substitute answers from memory.

1. Hacker News: fetch the three current top stories.
2. Context7: resolve Next.js, then retrieve documentation for an App Router Route Handler.
3. DeepWiki: read the wiki structure for vercel/next.js and list three sections.
4. OpenAI Docs: search the official documentation for Responses API function calling.

Keep the actual calls visible in the activity feed. Discovery alone does not count as success. Inspect each result for errors, including errors returned as ordinary text. Finish with a compact table listing each MCP, exact tool names called, one piece of returned evidence, and PASS or FAIL. If a call fails or is unavailable, report that honestly and continue testing the other MCPs without fallback.`,
  },
  { title: 'Create a tiny web page and print its HTML',
    prompt: 'Create a tiny web page and print its HTML' },
]

// Empty-state prompt cards: 2-col grid, stroke sharpens on hover.
export function SuggestedActions({
  onPick,
  disabled,
}: {
  onPick: (suggestion: string) => void
  disabled?: boolean
}) {
  return (
    <div className="no-scrollbar flex w-full gap-2.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible">
      {SUGGESTIONS.map(({ title, prompt }, index) => (
        <button
          className="fade-up min-w-[200px] shrink-0 whitespace-nowrap border border-stroke bg-bg-1 px-4 py-3 text-left text-[12px] text-fg-tertiary leading-relaxed transition-all duration-200 hover:border-stroke-active hover:bg-bg-highlight hover:text-fg disabled:pointer-events-none disabled:opacity-50 sm:min-w-0 sm:shrink sm:whitespace-normal sm:p-4 sm:text-[13px]"
          disabled={disabled}
          key={title}
          onClick={() => onPick(prompt)}
          style={{ animationDelay: `${index * 60}ms` }}
          type="button"
        >
          {title}
        </button>
      ))}
    </div>
  )
}
