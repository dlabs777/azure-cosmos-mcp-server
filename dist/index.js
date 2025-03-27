#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { CosmosClient } from "@azure/cosmos";
import * as dotenv from "dotenv";
dotenv.config();
// Cosmos DB client initialization
const cosmosClient = new CosmosClient({
    endpoint: process.env.COSMOSDB_URI,
    key: process.env.COSMOSDB_KEY,
});
const dbName = process.env.COSMOSDB_DATABASE || "todos";
const containerName = process.env.COSMOSDB_CONTAINER || "tasks";
// Tool definitions
const UPDATE_ITEM_TOOL = {
    name: "update_item",
    description: "Updates specific attributes of an item in a Azure Cosmos DB container",
    inputSchema: {
        type: "object",
        properties: {
            containerName: { type: "string", description: "Name of the container" },
            id: { type: "string", description: "ID of the item to update" },
            updates: { type: "object", description: "The updated attributes of the item" },
        },
        required: ["containerName", "id", "updates"],
    },
};
const PUT_ITEM_TOOL = {
    name: "put_item",
    description: "Inserts or replaces an item in a Azure Cosmos DB container",
    inputSchema: {
        type: "object",
        properties: {
            containerName: { type: "string", description: "Name of the  container" },
            item: { type: "object", description: "Item to insert into the container" },
        },
        required: ["containerName", "item"],
    },
};
const GET_ITEM_TOOL = {
    name: "get_item",
    description: "Retrieves an item from a Azure Cosmos DB container by its ID",
    inputSchema: {
        type: "object",
        properties: {
            containerName: { type: "string", description: "Name of the container" },
            id: { type: "string", description: "ID of the item to retrieve" },
        },
        required: ["containerName", "id"],
    },
};
const QUERY_CONTAINER_TOOL = {
    name: "query_container",
    description: "Queries a Azure Cosmos DB container using SQL-like syntax",
    inputSchema: {
        type: "object",
        properties: {
            containerName: { type: "string", description: "Name of the container" },
            query: { type: "string", description: "SQL query string" },
            parameters: { type: "array", description: "Query parameters" },
        },
        required: ["containerName", "query"],
    },
};
const LIST_CONTAINERS_TOOL = {
    name: "list_containers",
    description: "Lists all available containers in the database",
    inputSchema: {
        type: "object",
        properties: {},
        required: []
    }
};
const SAMPLE_ITEM_TOOL = {
    name: "sample_item",
    description: "Returns the most recent item from a specified container to understand its schema",
    inputSchema: {
        type: "object",
        properties: {
            containerName: { type: "string", description: "Name of the container to sample" },
            limit: { type: "number", description: "Maximum number of items to return (default: 1)" },
        },
        required: ["containerName"],
    },
};
// Function to truncate long string values to first 10 words
function truncateLongValues(value) {
    if (typeof value === 'string' && value.length > 100) {
        return value.split(' ').slice(0, 10).join(' ') + '...';
    }
    return value;
}
async function updateItem(params) {
    try {
        const { containerName, id, updates } = params;
        const selectedContainer = cosmosClient.database(dbName).container(containerName);
        const { resource } = await selectedContainer.item(id).read();
        if (!resource) {
            throw new Error("Item not found");
        }
        const updatedItem = { ...resource, ...updates };
        const { resource: updatedResource } = await selectedContainer.item(id).replace(updatedItem);
        return {
            success: true,
            message: `Item updated successfully in container ${containerName}`,
            item: updatedResource,
        };
    }
    catch (error) {
        console.error("Error updating item:", error);
        return {
            success: false,
            message: `Failed to update item: ${error}`,
        };
    }
}
async function putItem(params) {
    try {
        const { containerName, item } = params;
        const selectedContainer = cosmosClient.database(dbName).container(containerName);
        const { resource } = await selectedContainer.items.create(item);
        return {
            success: true,
            message: `Item added successfully to container ${containerName}`,
            item: resource,
        };
    }
    catch (error) {
        console.error("Error putting item:", error);
        return {
            success: false,
            message: `Failed to put item: ${error}`,
        };
    }
}
async function getItem(params) {
    try {
        const { containerName, id } = params;
        const selectedContainer = cosmosClient.database(dbName).container(containerName);
        const { resource } = await selectedContainer.item(id).read();
        return {
            success: true,
            message: `Item retrieved successfully from container ${containerName}`,
            item: resource,
        };
    }
    catch (error) {
        console.error("Error getting item:", error);
        return {
            success: false,
            message: `Failed to get item: ${error}`,
        };
    }
}
async function queryContainer(params) {
    try {
        const { containerName, query, parameters } = params;
        const selectedContainer = cosmosClient.database(dbName).container(containerName);
        const { resources } = await selectedContainer.items.query({ query, parameters }).fetchAll();
        return {
            success: true,
            message: `Query executed successfully on container ${containerName}`,
            items: resources,
        };
    }
    catch (error) {
        console.error("Error querying container:", error);
        return {
            success: false,
            message: `Failed to query container: ${error}`,
        };
    }
}
async function listContainers() {
    try {
        const database = cosmosClient.database(dbName);
        const { resources } = await database.containers.readAll().fetchAll();
        return {
            success: true,
            message: "Containers retrieved successfully",
            containers: resources.map(c => c.id)
        };
    }
    catch (error) {
        return {
            success: false,
            message: `Failed to list containers: ${error}`
        };
    }
}
async function sampleItem(params) {
    try {
        const { containerName, limit = 1 } = params;
        const selectedContainer = cosmosClient.database(dbName).container(containerName);
        const query = "SELECT * FROM c ORDER BY c._ts DESC OFFSET 0 LIMIT @limit";
        const queryParams = [{ name: "@limit", value: limit }];
        const { resources } = await selectedContainer.items.query({
            query,
            parameters: queryParams
        }).fetchAll();
        const truncatedResources = resources.map(item => {
            const truncatedItem = {};
            for (const key in item) {
                truncatedItem[key] = truncateLongValues(item[key]);
            }
            return truncatedItem;
        });
        return {
            success: true,
            message: `Retrieved ${resources.length} sample item(s) from container ${containerName}`,
            items: truncatedResources,
            schema: resources.length > 0 ? Object.keys(resources[0]).map(key => {
                return {
                    field: key,
                    type: typeof resources[0][key],
                    sample: truncateLongValues(resources[0][key])
                };
            }) : []
        };
    }
    catch (error) {
        console.error("Error sampling container:", error);
        return {
            success: false,
            message: `Failed to sample container: ${error}`,
        };
    }
}
const server = new Server({
    name: "cosmosdb-mcp-server",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [PUT_ITEM_TOOL, GET_ITEM_TOOL, QUERY_CONTAINER_TOOL, UPDATE_ITEM_TOOL, LIST_CONTAINERS_TOOL, SAMPLE_ITEM_TOOL],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        let result;
        switch (name) {
            case "put_item":
                result = await putItem(args);
                break;
            case "get_item":
                result = await getItem(args);
                break;
            case "query_container":
                result = await queryContainer(args);
                break;
            case "update_item":
                result = await updateItem(args);
                break;
            case "list_containers":
                result = await listContainers();
                break;
            case "sample_item":
                result = await sampleItem(args);
                break;
            default:
                return {
                    content: [{ type: "text", text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error occurred: ${error}` }],
            isError: true,
        };
    }
});
// Server startup
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Azure Cosmos DB Server running on stdio");
}
runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
