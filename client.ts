import OpenAI from "openai"
import { tools } from "./tools"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"

const MODEL = "qwen2.5-coder-14b-instruct"

const SYSTEM_PROMPT = `You are a helpful coding agent. You have access to tools that let you
read files, list directories, edit code, and run shell commands.

IMPORTANT:
- If the user asks you to run a command, use the bash tool.
- Never pretend that you executed a command.
- Never invent terminal output.
- If you did not use the bash tool, you must not claim command output.
- Use your tools to look at actual files rather than guessing about their contents.
- After using the bash tool, summarize only the actual bash output returned by the tool.
 Do not inspect unrelated files unless the user asks for that.

When you're done, respond with a clear summary of what you did or found.

## Environment
- User: ${Bun.spawnSync(["whoami"]).stdout.toString().trim()}
- OS: ${Bun.spawnSync(["uname", "-s"]).stdout.toString().trim()} ${Bun.spawnSync(["uname", "-r"]).stdout.toString().trim()}
- Shell: ${Bun.env.SHELL || "unknown"}
- Working directory: ${process.cwd()}
- Date: ${new Date().toISOString().slice(0, 10)}`

const openai = new OpenAI({
  baseURL: "http://localhost:1234/v1",
  apiKey: "lm-studio",
})

interface ToolCallEntry {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface Response {
  content: string | null
  toolCalls: ToolCallEntry[]
  wantsToUseTools: boolean
  toMessage(): ChatCompletionMessageParam
}


export async function sendMessage(
  conversation: ChatCompletionMessageParam[]
): Promise<Response> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversation,
  ]

  const stream = await openai.chat.completions.create({
    model: MODEL,
    messages,
    tools: tools.map((t) => t.definition),
    max_tokens: 4096,
    stream: true,
  })

  let content = ""
  const toolCallMap = new Map<number, ToolCallEntry>()
  let finishReason = ""

  for await (const chunk of stream) {
    const choice = chunk.choices[0]
    if (!choice) continue

    if (choice.finish_reason) finishReason = choice.finish_reason

    if (choice.delta.content) {
      content += choice.delta.content
    }

    if (choice.delta.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index
        if (!toolCallMap.has(idx)) {
          toolCallMap.set(idx, {
            id: "",
            type: "function",
            function: { name: "", arguments: "" },
          })
        }
        const entry = toolCallMap.get(idx)!
        if (tc.id) entry.id = tc.id
        if (tc.function?.name) entry.function.name += tc.function.name
        if (tc.function?.arguments)
          entry.function.arguments += tc.function.arguments
      }
    }
  }

  // Context tracking
  const totalChars = messages.reduce(
    (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
    0
  )
  const tokens = Math.ceil(totalChars / 4)
  console.log(`\n\x1b[2m[tokens: ~${tokens}/4096]\x1b[0m`)

  const toolCalls = [...toolCallMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v)

  return {
    content: content || null,
    toolCalls,
    wantsToUseTools: finishReason === "tool_calls",
    toMessage() {
      const msg: any = { role: "assistant", content: this.content }
      if (this.toolCalls.length) msg.tool_calls = this.toolCalls
      return msg
    },
  }
}
