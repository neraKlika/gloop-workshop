// agent.ts — A coding agent in TypeScript
//
// This is the complete agent. It does three things:
//   1. Takes input from you
//   2. Sends it to the model along with the full conversation history
//   3. If the model wants to use tools, runs them and sends results back
//
// The "intelligence" is in the model.
// The "agency" is in the loop.

import { sendMessage, type Response } from "./client"
import { findTool } from "./tools"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

const conversation: ChatCompletionMessageParam[] = []

console.log(cyan(`
  ┏━╸╻  ┏━┓┏━┓┏━┓
  ┃╺┓┃  ┃ ┃┃ ┃┣━┛
  ┗━┛┗━╸┗━┛┗━┛╹
`) + dim(`  coding agent · ${process.cwd()} · ctrl+c to quit\n`))

while (true) {
  const input = prompt(bold("you> "))
  if (!input) continue

  conversation.push({ role: "user", content: input })

  try {
    process.stdout.write("\n" + bold("agent> "))
    let response: Response = await sendMessage(conversation)

    // The inference loop — keep going while the model wants to use tools
    while (response.wantsToUseTools) {
      if (response.content) console.log()

      // Execute all requested tools in parallel
      const toolResults = await Promise.all(
        response.toolCalls.map(async (tc) => {
          const tool = findTool(tc.function.name)
          const input = JSON.parse(tc.function.arguments)
          const result = tool
            ? await tool.call(input)
            : `Error: unknown tool '${tc.function.name}'`

          console.log(dim(`  [${cyan(tc.function.name)}] ${JSON.stringify(input)}`))

          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            content: String(result),
          }
        })
      )

      // Add assistant response and tool results to conversation
      conversation.push(response.toMessage())
      toolResults.forEach((tr) => conversation.push(tr))

      // Ask the model again — it now has the tool results
      process.stdout.write("\n" + bold("agent> "))
      response = await sendMessage(conversation)
    }

    // Text was already streamed, just record it
    conversation.push(response.toMessage())
    console.log()
  } catch (e: any) {
    // Remove the user message we just pushed — the turn failed
    conversation.pop()

    const code = e?.error?.code || e?.code
    if (code === "ConnectionRefused" || code === "ECONNREFUSED") {
      console.log(dim("\n  Connection refused — is LM Studio running on localhost:1234?"))
    } else {
      console.log(dim(`\n  Error: ${e.message}`))
    }
  }
}
