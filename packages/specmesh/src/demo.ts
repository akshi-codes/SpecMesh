import { sourceHash, fail } from "./model.ts";
import type { ProjectState } from "./model.ts";
import { normalizeMarkdown } from "./importer.ts";

const specs = [
  [
    "US-1",
    "User registration",
    "IdentityAPI returns userId (string) and active (boolean) from GET /users/{userId}.",
    "",
  ],
  [
    "US-2",
    "Bank account linking",
    "BankAccountAPI returns accountId (string) and verified (boolean) from GET /accounts/{accountId}.",
    "Needs US-1 identity validation before linking.",
  ],
  [
    "US-3",
    "Fund transfer",
    "TransferAPI accepts POST /transfers with accountId (string) and amount (positive number); returns transferId (string).",
    "Needs US-1 identity validation and US-2 account verification. Account verification is not an atomic balance reservation.",
  ],
  [
    "US-4",
    "Transaction history",
    "Show confirmed transfer records.",
    "Needs US-3 transfer records via TransferAPI.",
  ],
  [
    "US-5",
    "Payment notifications",
    "Notify after a transfer commits.",
    "Consumes a TransferCompleted event from US-3; transport and delivery guarantees require a decision.",
  ],
];
export const demoFiles = specs.map(([key, title, contract, dependency]) => ({
  path: `stories/${key}.md`,
  content: `# ${key} — ${title}\n\n${contract}\n${dependency}\n\n## Acceptance Criteria\n- ${contract}\n- Record explicit success and failure outcomes.\n`,
}));
export function demoProposal(state: ProjectState) {
  if (
    !state.project.demo ||
    state.sources.length !== demoFiles.length ||
    demoFiles.some(
      (f) =>
        !state.sources.some(
          (s) => s.path === f.path && s.content === f.content,
        ),
    )
  )
    fail(
      "Demo analysis only supports the unchanged bundled five-story fixture. Use manual or Codex analysis for other projects.",
    );
  const evidence = (key: string) => {
    const s = state.sources.find((s) => s.path === `stories/${key}.md`)!;
    return [{ source: s.path, line: 4, quote: s.content.split("\n")[3] }];
  };
  const edges = [
    ["US-2", "US-1", "API", "IdentityAPI"],
    ["US-3", "US-1", "API", "IdentityAPI"],
    ["US-3", "US-2", "API", "BankAccountAPI"],
    ["US-4", "US-3", "API", "TransferAPI"],
    ["US-5", "US-3", "EVENT", "TransferCompleted"],
  ];
  return {
    dependencies: edges.map(([consumer, provider, type, interfaceId], i) => ({
      id: `DEP-${i + 1}`,
      consumer,
      provider,
      type,
      interfaceId,
      reason: "Relationship explicitly stated in the sample requirements.",
      evidence: evidence(consumer),
      classification: "EXPLICIT",
      review: "REVIEW_REQUIRED",
    })),
    decisions: [
      {
        id: "DEC-1",
        question:
          "Who owns atomic balance reservation and transfer commit? Verification alone cannot prevent competing transfers.",
        storyIds: ["US-3"],
        interfaceIds: ["TransferAPI"],
        critical: true,
        status: "OPEN",
        resolution: "",
        reviewer: "",
        evidence: evidence("US-3"),
      },
      {
        id: "DEC-2",
        question:
          "Which event transport, retry and duplicate-delivery guarantees will notifications use?",
        storyIds: ["US-5"],
        interfaceIds: ["TransferCompleted"],
        critical: true,
        status: "OPEN",
        resolution: "",
        reviewer: "",
        evidence: evidence("US-5"),
      },
    ],
  };
}
export function demoContract(key: string, version = "1.0.0") {
  const value =
    key === "IdentityAPI"
      ? { userId: "user-1", active: true }
      : key === "BankAccountAPI"
        ? { accountId: "account-1", verified: true }
        : { transferId: "transfer-1" };
  const route =
    key === "IdentityAPI"
      ? "/users/{userId}"
      : key === "BankAccountAPI"
        ? "/accounts/{accountId}"
        : "/transfers";
  if (!["IdentityAPI", "BankAccountAPI", "TransferAPI"].includes(key))
    fail("No sample HTTP contract for this interface.");
  const schema = {
    type: "object",
    required: Object.keys(value),
    properties: Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, { type: typeof v }]),
    ),
  };
  const responses = {
    "422": {
      description: "Validation failed",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["error"],
            properties: { error: { type: "string" } },
          },
          example: { error: "Request validation failed" },
        },
      },
    },
    "200": {
      description: "Sample success",
      content: { "application/json": { schema, example: value } },
    },
    "401": {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["error"],
            properties: { error: { type: "string" } },
          },
          example: { error: "Unauthorized" },
        },
      },
    },
    "404": {
      description: "Not found",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["error"],
            properties: { error: { type: "string" } },
          },
          example: { error: "Not found" },
        },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: { title: key, version },
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    },
    paths: {
      [route]:
        key === "TransferAPI"
          ? {
              post: {
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["accountId", "amount"],
                        properties: {
                          accountId: { type: "string" },
                          amount: { type: "number", exclusiveMinimum: 0 },
                        },
                      },
                    },
                  },
                },
                responses,
              },
            }
          : {
              get: {
                parameters: [
                  {
                    name: key === "IdentityAPI" ? "userId" : "accountId",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                  },
                ],
                responses,
              },
            },
    },
  };
}
