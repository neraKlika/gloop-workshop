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

class ToolApprovalRejectedError extends Error {
  constructor(toolName: string) {
    super(`Approval rejected for tool: ${toolName}`)
    this.name = "ToolApprovalRejectedError"
  }
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

const approvalRequiredTools = new Set([
  "write_file",
  "edit_file",
  "bash",
])

const conversation: ChatCompletionMessageParam[] = []

console.log(cyan(`
  ┏━╸╻  ┏━┓┏━┓┏━┓
  ┃╺┓┃  ┃ ┃┃ ┃┣━┛
  ┗━┛┗━╸┗━┛┗━┛╹
`) + dim(`  coding agent · ${process.cwd()} · ctrl+c to quit\n`))

while (true) {
  const input = prompt(bold("you> "))
  if (!input) continue

  if (input.trim().startsWith("run ")) {
  const command = input.trim().slice(4)

  console.log(dim(`\n  Agent wants to use tool: ${cyan("bash")}`))
  console.log(dim(`  Input: ${JSON.stringify({ command }, null, 2)}`))

  const approved = prompt(bold("approve? (y/n) "))

  if (approved?.toLowerCase() !== "y") {
    console.log(dim("\n  Approval rejected. No changes were made."))
    continue
  }

  const tool = findTool("bash")
  const result = tool
    ? await tool.call({ command })
    : "Error: bash tool not found"

  console.log(dim(`  [${cyan("bash")}] ${JSON.stringify({ command })}`))
  console.log(String(result) || dim("  <no output>"))
  continue
}

  conversation.push({ role: "user", content: input })

  try {
    process.stdout.write("\n" + bold("agent> "))
    let response: Response = await sendMessage(conversation)
    if (!response.wantsToUseTools && response.content) {
      process.stdout.write(response.content)
    }

    // The inference loop — keep going while the model wants to use tools
    while (response.wantsToUseTools) {
      if (response.content) console.log()

      // Execute all requested tools in parallel
      const toolResults = await Promise.all(
        response.toolCalls.map(async (tc) => {
          const toolName = tc.function.name
          const tool = findTool(toolName)
          const input = JSON.parse(tc.function.arguments)

          if (approvalRequiredTools.has(toolName)) {
            console.log(dim(`\n  Agent wants to use tool: ${cyan(toolName)}`))
            console.log(dim(`  Input: ${JSON.stringify(input, null, 2)}`))

            const approved = prompt(bold("approve? (y/n) "))

            if (approved?.toLowerCase() !== "y") {
              throw new ToolApprovalRejectedError(toolName)
            }
          }

          const result = tool
            ? await tool.call(input)
            : `Error: unknown tool '${toolName}'`

          console.log(dim(`  [${cyan(toolName)}] ${JSON.stringify(input)}`))

          if (toolName === "bash") {
            console.log(dim("\n  Command output:"))
            console.log(String(result) || dim("  <no output>"))
          }

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
      if (!response.wantsToUseTools && response.content) {
        process.stdout.write(response.content)
      }
    }

    // Text was already streamed, just record it
    conversation.push(response.toMessage())
    console.log()
  } catch (e: any) {
    // Remove the user message we just pushed — the turn failed
    conversation.pop()

    if (e instanceof ToolApprovalRejectedError) {
    console.log(dim("\n  Approval rejected. No changes were made."))
    continue
  }

    const code = e?.error?.code || e?.code
    if (code === "ConnectionRefused" || code === "ECONNREFUSED") {
      console.log(dim("\n  Connection refused — is LM Studio running on localhost:1234?"))
    } else {
      console.log(dim(`\n  Error: ${e.message}`))
    }
  }
}
