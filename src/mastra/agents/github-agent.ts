import { Agent, ToolsInput } from "@mastra/core/agent";
import { githubMCP } from "../mcps/github-mcp-client";
import { openai } from "@ai-sdk/openai";
import { githubAgentInstructions } from "./prompts/github-agent-instructions";
import { DynamicArgument } from "@mastra/core/base";

enum AgentRole {
    discovery = "discovery",
    fix = "fix",
    commit = "commit",
    openPr = "openPr",
    mergePr = "mergePr",
}

type AnyTool = { id?: string; name?: string; role?: string } & Record<string, any>;

// helper: consistent key for name/id
const toolKey = (t: AnyTool) => String(t.name ?? t.id ?? '');

const roleToolMap: Record<AgentRole, string[] | ((tool: AnyTool) => boolean)> = {
    discovery: [
        'github_get_file_contents',
        'github_search_code',
        'github_list_branches',
        'github_list_commits',
        'github_get_commit',
        'github_search_repositories',
        'github_list_issues',
        'github_get_issue',
    ],
    fix: (tool) => tool.role === 'fix',
    commit: (tool) => tool.role === 'commit',
    openPr: (tool) => tool.role === 'openPr',
    mergePr: (tool) => tool.role === 'mergePr',
};

// Overloads keep correct return type based on input
export function filterTools(role: AgentRole, tools: AnyTool[]): AnyTool[];
export function filterTools(role: AgentRole, tools: Record<string, AnyTool>): Record<string, AnyTool>;
export function filterTools(role: AgentRole, tools: AnyTool[] | Record<string, AnyTool>) {
    const rule = roleToolMap[role];

    // normalize to array for filtering
    const arr: AnyTool[] = Array.isArray(tools) ? tools : Object.values(tools ?? {});

    const filtered = !rule
        ? arr
        : (typeof rule === 'function'
            ? arr.filter(rule)
            : arr.filter((t) => rule.includes(toolKey(t))));

    // return in same shape as input
    if (Array.isArray(tools)) return filtered;

    const out: Record<string, AnyTool> = {};
    // preserve original keys when possible
    for (const [k, v] of Object.entries(tools)) {
        if (filtered.includes(v)) out[k] = v;
    }
    return out;
}

export const githubAgent = new Agent({
    name: "Github Discovery Agent",
    instructions: githubAgentInstructions,
    model: openai("gpt-5-nano", { reasoningEffort: "high" }),
    tools: await filterTools(AgentRole.discovery, await githubMCP.getTools()) as DynamicArgument<ToolsInput>,
})
