/**
 * index.ts — OpenClaw plugin entry point
 *
 * Registers four tools:
 *   workflow_config   → get stage paths & naming rules for a workflow
 *   workflow_register → register a new work item
 *   workflow_query    → find items by workflow/stage/status
 *   workflow_advance  → move an item to its next stage, get output path
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { WorkflowRegistry } from "./registry.js";
import { loadWorkflowConfig, listWorkflows } from "./config-loader.js";

let registry: WorkflowRegistry | null = null;

function getRegistry(): WorkflowRegistry {
  if (!registry) {
    registry = new WorkflowRegistry();
  }
  return registry;
}

export default definePluginEntry({
  id: "workflow-directory",
  name: "Workflow Directory",
  description:
    "Lets agents discover where to read/write artifacts without hardcoded paths",

  register(api) {
    // ── workflow_config ─────────────────────────────────────────────
    api.registerTool({
      name: "workflow_config",
      description: [
        "Get the configuration for a workflow: stage names, paths, naming rules, and transitions.",
        "Use this to discover where artifacts live before reading or writing.",
        "Call with no arguments to list all available workflows.",
      ].join(" "),
      parameters: Type.Object({
        workflow: Type.Optional(
          Type.String({
            description:
              "Workflow name. Omit to list all available workflows.",
          })
        ),
      }),
      async execute(_id, params) {
        try {
          if (!params.workflow) {
            const workflows = listWorkflows();
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ workflows }, null, 2),
                },
              ],
            };
          }

          const config = loadWorkflowConfig(params.workflow);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(config, null, 2),
              },
            ],
          };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          };
        }
      },
    });

    // ── workflow_register ───────────────────────────────────────────
    api.registerTool({
      name: "workflow_register",
      description: [
        "Register a new work item in a workflow at a specific stage.",
        "Returns the resolved artifact path where you should save the file.",
        "Example: register an idea from Discord into the 'backlog' stage.",
      ].join(" "),
      parameters: Type.Object({
        workflow: Type.String({ description: "Workflow name" }),
        stage: Type.String({
          description: "Stage to register the item at (e.g. 'backlog')",
        }),
        name: Type.String({
          description:
            "Item name — used in file naming. Use a short descriptive slug (e.g. 'mobile-nav-redesign')",
        }),
        metadata: Type.Optional(
          Type.Object({}, {
            additionalProperties: true,
            description:
              "Optional key-value metadata to attach (e.g. source, tags, priority)",
          })
        ),
      }),
      async execute(_id, params) {
        try {
          const reg = getRegistry();
          const item = reg.register(
            params.workflow,
            params.stage,
            params.name,
            params.metadata ?? {}
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    registered: true,
                    item_name: item.name,
                    stage: item.current_stage,
                    artifact_path: item.artifact_path,
                    message: `Save the artifact to: ${item.artifact_path}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          };
        }
      },
    });

    // ── workflow_query ──────────────────────────────────────────────
    api.registerTool({
      name: "workflow_query",
      description: [
        "Query work items in a workflow. Filter by stage, status, or name.",
        "Use this to find what items are waiting for you to process.",
        "Returns item names, paths, statuses, and metadata.",
      ].join(" "),
      parameters: Type.Object({
        workflow: Type.String({ description: "Workflow name" }),
        stage: Type.Optional(
          Type.String({
            description: "Filter by stage (e.g. 'backlog', 'researched')",
          })
        ),
        status: Type.Optional(
          Type.Union(
            [
              Type.Literal("pending"),
              Type.Literal("in_progress"),
              Type.Literal("complete"),
              Type.Literal("failed"),
            ],
            { description: "Filter by status. Default: return all statuses." }
          )
        ),
        name: Type.Optional(
          Type.String({ description: "Search by item name (partial match)" })
        ),
        limit: Type.Optional(
          Type.Number({
            description: "Max results to return (default 50)",
          })
        ),
      }),
      async execute(_id, params) {
        try {
          const reg = getRegistry();
          const items = reg.query({
            workflow: params.workflow,
            stage: params.stage,
            status: params.status,
            name: params.name,
            limit: params.limit,
          });

          if (items.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    items: [],
                    message: `No items found in "${params.workflow}"${params.stage ? ` at stage "${params.stage}"` : ""}${params.status ? ` with status "${params.status}"` : ""}.`,
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    count: items.length,
                    items: items.map((i) => ({
                      name: i.name,
                      stage: i.current_stage,
                      status: i.status,
                      artifact_path: i.artifact_path,
                      metadata: i.metadata,
                      updated_at: i.updated_at,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          };
        }
      },
    });

    // ── workflow_advance ────────────────────────────────────────────
    api.registerTool({
      name: "workflow_advance",
      description: [
        "Advance a work item to its next stage in the workflow.",
        "Returns the new artifact path where you should save your output.",
        "The next stage is determined by the workflow's transition rules,",
        "or you can specify a target stage explicitly.",
      ].join(" "),
      parameters: Type.Object({
        workflow: Type.String({ description: "Workflow name" }),
        item_name: Type.String({ description: "Name of the item to advance" }),
        to_stage: Type.Optional(
          Type.String({
            description:
              "Target stage. Omit to follow the default transition.",
          })
        ),
      }),
      async execute(_id, params) {
        try {
          const reg = getRegistry();
          const result = reg.advance(
            params.workflow,
            params.item_name,
            params.to_stage
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    advanced: true,
                    item_name: result.item.name,
                    from_stage: result.from_stage,
                    to_stage: result.to_stage,
                    save_to: result.save_to,
                    message: `Item moved from "${result.from_stage}" → "${result.to_stage}". Save output to: ${result.save_to}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          };
        }
      },
    });
  },
});
