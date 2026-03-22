import fs from "node:fs/promises";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { bootstrapExpressServerForMCPServer } from "@/mcp/bootstrap";

type Entity = {
  name: string;
  entityType: string;
  observations: string[];
};

type Relation = {
  from: string;
  to: string;
  relationType: string;
};

type KnowledgeGraph = {
  entities: Entity[];
  relations: Relation[];
};

const defaultMemoryPath = path.join(
  process.cwd(),
  ".data",
  "memory",
  "memory.jsonl",
);

const getMemoryFilePath = () => {
  const configured = process.env.MEMORY_FILE_PATH?.trim();
  if (!configured) {
    return defaultMemoryPath;
  }

  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
};

const readGraph = async (memoryFilePath: string): Promise<KnowledgeGraph> => {
  try {
    const data = await fs.readFile(memoryFilePath, "utf8");
    const lines = data.split("\n").filter((line) => line.trim().length > 0);
    return lines.reduce<KnowledgeGraph>(
      (graph, line) => {
        const item = JSON.parse(line) as
          | { type: "entity"; name: string; entityType: string; observations: string[] }
          | { type: "relation"; from: string; to: string; relationType: string };

        if (item.type === "entity") {
          graph.entities.push({
            name: item.name,
            entityType: item.entityType,
            observations: item.observations ?? [],
          });
        } else {
          graph.relations.push({
            from: item.from,
            to: item.to,
            relationType: item.relationType,
          });
        }

        return graph;
      },
      { entities: [], relations: [] },
    );
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null;

    if (code === "ENOENT") {
      return { entities: [], relations: [] };
    }

    throw error;
  }
};

const writeGraph = async (memoryFilePath: string, graph: KnowledgeGraph) => {
  await fs.mkdir(path.dirname(memoryFilePath), { recursive: true });

  const lines = [
    ...graph.entities.map((entity) =>
      JSON.stringify({
        type: "entity",
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations,
      }),
    ),
    ...graph.relations.map((relation) =>
      JSON.stringify({
        type: "relation",
        from: relation.from,
        to: relation.to,
        relationType: relation.relationType,
      }),
    ),
  ];

  await fs.writeFile(memoryFilePath, lines.join("\n"), "utf8");
};

const entitySchema = z.object({
  name: z.string(),
  entityType: z.string(),
  observations: z.array(z.string()),
});

const relationSchema = z.object({
  from: z.string(),
  to: z.string(),
  relationType: z.string(),
});

const createMemoryMcpServer = () => {
  const server = new McpServer({
    name: "memory-mcp-http",
    version: "0.1.0",
  });

  const memoryFilePath = getMemoryFilePath();

  server.registerTool(
    "create_entities",
    {
      title: "Create Entities",
      description: "Create entities in memory knowledge graph.",
      inputSchema: {
        entities: z.array(entitySchema),
      },
    },
    async ({ entities }) => {
      const graph = await readGraph(memoryFilePath);
      const existing = new Set(graph.entities.map((item) => item.name));
      const created = entities.filter((item) => !existing.has(item.name));
      graph.entities.push(...created);
      await writeGraph(memoryFilePath, graph);
      return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] };
    },
  );

  server.registerTool(
    "create_relations",
    {
      title: "Create Relations",
      description: "Create relations in memory knowledge graph.",
      inputSchema: {
        relations: z.array(relationSchema),
      },
    },
    async ({ relations }) => {
      const graph = await readGraph(memoryFilePath);
      const created = relations.filter(
        (relation) =>
          !graph.relations.some(
            (existing) =>
              existing.from === relation.from &&
              existing.to === relation.to &&
              existing.relationType === relation.relationType,
          ),
      );
      graph.relations.push(...created);
      await writeGraph(memoryFilePath, graph);
      return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] };
    },
  );

  server.registerTool(
    "add_observations",
    {
      title: "Add Observations",
      description: "Append observations to existing entities.",
      inputSchema: {
        observations: z.array(
          z.object({
            entityName: z.string(),
            contents: z.array(z.string()),
          }),
        ),
      },
    },
    async ({ observations }) => {
      const graph = await readGraph(memoryFilePath);
      const result: Array<{ entityName: string; addedObservations: string[] }> = [];

      for (const item of observations) {
        const entity = graph.entities.find((entry) => entry.name === item.entityName);
        if (!entity) {
          continue;
        }

        const toAdd = item.contents.filter(
          (content) => !entity.observations.includes(content),
        );
        entity.observations.push(...toAdd);
        result.push({
          entityName: item.entityName,
          addedObservations: toAdd,
        });
      }

      await writeGraph(memoryFilePath, graph);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "delete_entities",
    {
      title: "Delete Entities",
      description: "Delete entities and their attached relations.",
      inputSchema: {
        entityNames: z.array(z.string()),
      },
    },
    async ({ entityNames }) => {
      const graph = await readGraph(memoryFilePath);
      const names = new Set(entityNames);
      graph.entities = graph.entities.filter((entity) => !names.has(entity.name));
      graph.relations = graph.relations.filter(
        (relation) => !names.has(relation.from) && !names.has(relation.to),
      );
      await writeGraph(memoryFilePath, graph);
      return { content: [{ type: "text", text: "Entities deleted successfully" }] };
    },
  );

  server.registerTool(
    "delete_observations",
    {
      title: "Delete Observations",
      description: "Delete observations from entities.",
      inputSchema: {
        deletions: z.array(
          z.object({
            entityName: z.string(),
            observations: z.array(z.string()),
          }),
        ),
      },
    },
    async ({ deletions }) => {
      const graph = await readGraph(memoryFilePath);
      for (const deletion of deletions) {
        const entity = graph.entities.find((entry) => entry.name === deletion.entityName);
        if (!entity) {
          continue;
        }

        const toRemove = new Set(deletion.observations);
        entity.observations = entity.observations.filter(
          (observation) => !toRemove.has(observation),
        );
      }

      await writeGraph(memoryFilePath, graph);
      return { content: [{ type: "text", text: "Observations deleted successfully" }] };
    },
  );

  server.registerTool(
    "delete_relations",
    {
      title: "Delete Relations",
      description: "Delete exact relation triples.",
      inputSchema: {
        relations: z.array(relationSchema),
      },
    },
    async ({ relations }) => {
      const graph = await readGraph(memoryFilePath);
      graph.relations = graph.relations.filter(
        (relation) =>
          !relations.some(
            (target) =>
              target.from === relation.from &&
              target.to === relation.to &&
              target.relationType === relation.relationType,
          ),
      );
      await writeGraph(memoryFilePath, graph);
      return { content: [{ type: "text", text: "Relations deleted successfully" }] };
    },
  );

  server.registerTool(
    "read_graph",
    {
      title: "Read Graph",
      description: "Read full memory graph.",
      inputSchema: {},
    },
    async () => {
      const graph = await readGraph(memoryFilePath);
      return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
    },
  );

  server.registerTool(
    "search_nodes",
    {
      title: "Search Nodes",
      description: "Search entities by name/type/observation text.",
      inputSchema: {
        query: z.string(),
      },
    },
    async ({ query }) => {
      const graph = await readGraph(memoryFilePath);
      const q = query.toLowerCase();
      const entities = graph.entities.filter(
        (entity) =>
          entity.name.toLowerCase().includes(q) ||
          entity.entityType.toLowerCase().includes(q) ||
          entity.observations.some((observation) => observation.toLowerCase().includes(q)),
      );
      const names = new Set(entities.map((entity) => entity.name));
      const relations = graph.relations.filter(
        (relation) => names.has(relation.from) && names.has(relation.to),
      );
      return { content: [{ type: "text", text: JSON.stringify({ entities, relations }, null, 2) }] };
    },
  );

  server.registerTool(
    "open_nodes",
    {
      title: "Open Nodes",
      description: "Read exact entities by names.",
      inputSchema: {
        names: z.array(z.string()),
      },
    },
    async ({ names }) => {
      const graph = await readGraph(memoryFilePath);
      const nameSet = new Set(names);
      const entities = graph.entities.filter((entity) => nameSet.has(entity.name));
      const entityNames = new Set(entities.map((entity) => entity.name));
      const relations = graph.relations.filter(
        (relation) =>
          entityNames.has(relation.from) && entityNames.has(relation.to),
      );
      return { content: [{ type: "text", text: JSON.stringify({ entities, relations }, null, 2) }] };
    },
  );

  return server;
};

const enabled = process.env.MEMORY_MCP_ENABLED === "true";
if (!enabled) {
  console.log("[mcp:memory] disabled");
} else {
  bootstrapExpressServerForMCPServer(
    process.env.MEMORY_MCP_PORT ? parseInt(process.env.MEMORY_MCP_PORT, 10) : 9558,
    createMemoryMcpServer,
  );
}
