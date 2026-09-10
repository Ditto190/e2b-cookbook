export function Greeting() {
  return (
    <div className="flex flex-col items-center px-4">
      <div className="fade-up text-center font-bold text-2xl text-fg md:text-3xl">
        What can I help with?
      </div>
      <div className="fade-up mt-3 text-center text-body text-fg-tertiary [animation-delay:0.15s]">
        Your first prompt creates an Agents API session and an E2B sandbox —
        the agent works in /workspace.
      </div>
    </div>
  )
}
