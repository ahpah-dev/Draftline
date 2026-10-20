import type { Thread } from "./types";
export const exampleFiles: Record<string, string> = {
  "src/app.ts": `import { createServer } from './server';\nimport { loadConfig } from './config';\n\n// A small project, ready for your next idea.\nconst config = loadConfig();\nconst server = createServer(config);\n\nserver.listen(config.port, () => {\n  console.log('Ready to build something.');\n});\n`,
  "src/config.ts": `export function loadConfig() {\n  return {\n    port: Number(process.env.PORT ?? 3000),\n    environment: process.env.NODE_ENV ?? 'development',\n  };\n}\n`,
  "package.json": `{\n  "name": "my-next-idea",\n  "scripts": {\n    "dev": "tsx watch src/app.ts",\n    "test": "node --test"\n  }\n}\n`,
  "README.md": `# My next idea\n\nA little space for something great.\n\n## Development\n\nnpm install\nnpm run dev\n\n## Checks\n\nnpm test\n`,
};
export const initialThreads: Thread[] = [
  {
    id: "demo-explore",
    title: "Explore the project structure",
    updated: Date.now() - 3600000,
    demo: true,
    messages: [
      {
        id: "demo-u",
        role: "user",
        content: "Give me a quick tour of this project.",
        demo: true,
      },
      {
        id: "demo-a",
        role: "assistant",
        content:
          "This is a small TypeScript application. The entry point is `src/app.ts`, and runtime configuration lives in `src/config.ts`.\n\nStart with `npm run dev` for development, or `npm test` to run the checks. A good next step is to add input validation to the configuration loader.\n\nThis is an illustrative demo. Connect a local runtime to explore your own project.",
        demo: true,
      },
    ],
    tools: [
      {
        id: "d1",
        name: "list_files",
        args: { path: "." },
        state: "completed",
        result: ["src/", "package.json", "README.md"],
      },
      {
        id: "d2",
        name: "read_file",
        args: { path: "src/app.ts" },
        state: "completed",
        result: exampleFiles["src/app.ts"],
      },
    ],
  },
];
export const suggestions = [
  {
    kind: "Explore",
    title: "Explore a codebase",
    description: "Find the architecture. See the big picture.",
    prompt:
      "Explore this project. Explain its architecture, entry points, and how to run it.",
  },
  {
    kind: "Build",
    title: "Build a feature",
    description: "Turn a good idea into working code.",
    prompt:
      "Help me plan a new feature for this project. First explore the code and ask me what I want to build.",
  },
  {
    kind: "Improve",
    title: "Review code",
    description: "Spot a bug. Make things a little better.",
    prompt:
      "Review this project for a small, useful improvement. Explain the proposed fix before changing files.",
  },
];
