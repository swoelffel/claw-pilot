/**
 * runtime/agent/defaults.ts
 *
 * Built-in agent definitions for claw-runtime.
 * These are the agents available out-of-the-box.
 *
 * Note: Prompt text is inlined as string constants.
 * The canonical source is the corresponding .txt files in ./prompt/.
 * tsdown does not support raw .txt imports without a plugin.
 */

import type { Agent } from "./agent.js";
import {
  EXPLORE_AGENT_RULESET,
  PLAN_AGENT_RULESET,
  INTERNAL_AGENT_RULESET,
} from "../permission/index.js";

// ---------------------------------------------------------------------------
// Prompt strings (inlined from ./prompt/*.txt)
// ---------------------------------------------------------------------------

const PROMPT_BUILD = `You are a powerful agentic AI coding assistant. You can execute tools to help the user with coding tasks.

Guidelines:
- Always read files before editing them
- Prefer targeted edits over full rewrites
- Run tests after making changes when a test suite is available
- Ask for clarification when the request is ambiguous
- Be concise in your responses — avoid unnecessary prose`;

const PROMPT_PLAN = `You are a planning assistant. Your role is to analyze tasks and produce clear, actionable plans.

Guidelines:
- Do NOT edit files (except plan documents in .opencode/plans/)
- Read and explore the codebase to understand the context
- Produce step-by-step plans in Markdown format
- Ask clarifying questions before planning if the request is ambiguous
- Focus on correctness and completeness over brevity`;

const PROMPT_EXPLORE = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Use Bash for file operations like copying, moving, or listing directory contents
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run bash commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.`;

const PROMPT_COMPACTION = `You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary of the conversation.
Focus on information that would be helpful for continuing the conversation, including:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests, constraints, or preferences that should persist
- Important technical decisions and why they were made

Your summary should be comprehensive enough to provide context but concise enough to be quickly understood.

Do not respond to any questions in the conversation, only output the summary.`;

const PROMPT_TITLE = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- ≤50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  → create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" → Debugging production 500 errors
"refactor user service" → Refactoring user service
"why is app.js failing" → app.js failure investigation
"implement rate limiting" → Rate limiting implementation
"how do I connect postgres to my API" → Postgres API connection
"best practices for React hooks" → React hooks best practices
"@src/auth.ts can you add refresh token support" → Auth refresh token support
"@utils/parser.ts this is broken" → Parser bug fix
"look at @config.json" → Config review
"@App.tsx add dark mode toggle" → Dark mode toggle in App
</examples>`;

const PROMPT_SUMMARY = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that exact question
- If the conversation ends with an imperative statement or request to the user (e.g. "Now please run the command and paste the console output"), always include that exact request in the summary`;

// ---------------------------------------------------------------------------
// Default permission ruleset for most agents
// ---------------------------------------------------------------------------

const DEFAULT_RULESET = [
  { permission: "*", pattern: "**", action: "allow" as const },
  { permission: "read", pattern: "*.env", action: "ask" as const },
  { permission: "read", pattern: "*.env.*", action: "ask" as const },
  { permission: "read", pattern: "*.env.example", action: "allow" as const },
];

// ---------------------------------------------------------------------------
// Built-in agent definitions
// ---------------------------------------------------------------------------

/** Build agent — default coding agent */
export const BUILD_AGENT: Agent.Info = {
  name: "build",
  description: "The default agent. Executes tools based on configured permissions.",
  mode: "primary",
  native: true,
  prompt: PROMPT_BUILD,
  permission: [...DEFAULT_RULESET, { permission: "question", pattern: "**", action: "allow" }],
  options: {},
};

/** Plan agent — read-only planning */
export const PLAN_AGENT: Agent.Info = {
  name: "plan",
  description: "Plan mode. Reads the codebase and produces plans without editing files.",
  mode: "primary",
  native: true,
  prompt: PROMPT_PLAN,
  permission: PLAN_AGENT_RULESET,
  options: {},
};

/** Explore agent — fast read-only codebase search */
export const EXPLORE_AGENT: Agent.Info = {
  name: "explore",
  description:
    'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
  mode: "subagent",
  native: true,
  prompt: PROMPT_EXPLORE,
  permission: EXPLORE_AGENT_RULESET,
  options: {},
};

/** General agent — multi-step research and execution */
export const GENERAL_AGENT: Agent.Info = {
  name: "general",
  description:
    "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.",
  mode: "subagent",
  native: true,
  permission: [
    ...DEFAULT_RULESET,
    { permission: "todoread", pattern: "**", action: "deny" },
    { permission: "todowrite", pattern: "**", action: "deny" },
  ],
  options: {},
};

/** Compaction agent — internal, hidden */
export const COMPACTION_AGENT: Agent.Info = {
  name: "compaction",
  mode: "primary",
  native: true,
  hidden: true,
  prompt: PROMPT_COMPACTION,
  permission: INTERNAL_AGENT_RULESET,
  options: {},
};

/** Title agent — internal, hidden */
export const TITLE_AGENT: Agent.Info = {
  name: "title",
  mode: "primary",
  native: true,
  hidden: true,
  temperature: 0.5,
  prompt: PROMPT_TITLE,
  permission: INTERNAL_AGENT_RULESET,
  options: {},
};

/** Summary agent — internal, hidden */
export const SUMMARY_AGENT: Agent.Info = {
  name: "summary",
  mode: "primary",
  native: true,
  hidden: true,
  prompt: PROMPT_SUMMARY,
  permission: INTERNAL_AGENT_RULESET,
  options: {},
};

/** All built-in agents in default order */
export const BUILTIN_AGENTS: Agent.Info[] = [
  BUILD_AGENT,
  PLAN_AGENT,
  EXPLORE_AGENT,
  GENERAL_AGENT,
  COMPACTION_AGENT,
  TITLE_AGENT,
  SUMMARY_AGENT,
];
