// tools.ts — The hands of our agent
//
// Each tool has two parts:
//   1. A definition — a description sent to the model so it knows what's available
//   2. A call method — the code that actually runs when the model uses the tool
//
// The model never sees the call method. It only sees the definition.

import { readdir } from "node:fs/promises"
import { join } from "node:path"
import type { ChatCompletionTool } from "openai/resources/chat/completions"

interface Tool {
  definition: ChatCompletionTool
  call(input: Record<string, string>): Promise<string>
}

const readFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file at the given path. Use this when you need to see what's inside a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to read" },
        },
        required: ["path"],
      },
    },
  },
  async call(input) {
    const file = Bun.file(input.path)
    if (!(await file.exists())) return `Error: file not found — ${input.path}`
    try {
      return await file.text()
    } catch (e: any) {
      return `Error: ${e.message}`
    }
  },
}

const listFilesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List all files and directories at the given path. Directories end with a trailing slash.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The directory path to list",
          },
        },
        required: ["path"],
      },
    },
  },
  async call(input) {
    try {
      const entries = await readdir(input.path, { withFileTypes: true })
      return entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join("\n")
    } catch (e: any) {
      return `Error: ${e.code === "ENOENT" ? `directory not found — ${input.path}` : e.message}`
    }
  },
}

const writeFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create a new file or overwrite an existing file with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path to write to",
          },
          content: {
            type: "string",
            description: "The full content to write to the file",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  async call(input) {
    try {
      await Bun.write(input.path, input.content)
      return `Created ${input.path}`
    } catch (e: any) {
      return `Error: ${e.message}`
    }
  },
}

const editFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace a specific string in an existing file. Use read_file first to see the current content, then provide the exact text to find and its replacement.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path to edit",
          },
          old_string: {
            type: "string",
            description: "The exact text to find in the file",
          },
          new_string: {
            type: "string",
            description: "The text to replace it with",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  async call(input) {
    try {
      const file = Bun.file(input.path)
      const content = await file.text()
      if (!content.includes(input.old_string)) {
        return `Error: old_string not found in ${input.path}`
      }
      await Bun.write(input.path, content.replace(input.old_string, input.new_string))
      return `Edited ${input.path}`
    } catch (e: any) {
      return `Error: ${e.message}`
    }
  },
}

const bashTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a shell command and return its output. Use this for git, tests, installing packages, or any system operation.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to run",
          },
        },
        required: ["command"],
      },
    },
  },
  async call(input) {
    const proc = Bun.spawnSync(["sh", "-c", input.command], {
      timeout: 30_000,
    })

    if (proc.exitedDueToTimeout) {
      return "Error: command timed out after 30 seconds"
    }

    const stdout = proc.stdout.toString()
    const stderr = proc.stderr.toString()
    const output = stdout + stderr

    if (proc.success) return output
    return output ? `${output}\n[exit code: ${proc.exitCode}]` : `[exit code: ${proc.exitCode}]`
  },
}

// --- Tool Registry ---

export const tools: Tool[] = [readFileTool, listFilesTool, writeFileTool, editFileTool, bashTool]

export function findTool(name: string): Tool | undefined {
  return tools.find((t) => t.definition.function.name === name)
}
