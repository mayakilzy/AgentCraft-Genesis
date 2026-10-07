/**
 * G6-02 — Reference A2A Agent (test infrastructure, NOT production code).
 *
 * Per Section 35: "Place test/reference implementation under:
 * experiments/g6-02/ or test fixtures, not production code."
 *
 * A bounded local A2A reference agent that implements just enough of the
 * A2A v1.0 JSON-RPC protocol for the G6-02 interoperability probes. It:
 *
 *   1. Serves /.well-known/agent-card.json (agent discovery).
 *   2. Handles the SendMessage JSON-RPC method (creates a task, computes
 *      a deterministic result, returns the task).
 *   3. Handles the GetTask JSON-RPC method (returns the task state).
 *   4. Handles the CancelTask JSON-RPC method (marks the task canceled).
 *
 * The agent runs as an INDEPENDENT Node.js process — communication
 * crosses the real HTTP/JSON-RPC boundary (Section 34). It is NOT a
 * Genesis Worker; it is not part of the Genesis production runtime.
 *
 * Modes (selected via the MODE environment variable):
 *   success        — returns the correct deterministic result (Probe A).
 *   failure        — returns a failed task state (Probe B).
 *   trust-boundary — returns a completed task with a wrong result (Probe C).
 *
 * Usage:
 *   node experiments/g6-02/reference-agent/server.mjs
 *   MODE=success PORT=4173 node experiments/g6-02/reference-agent/server.mjs
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

const PORT = parseInt(process.env.PORT ?? '4173', 10);
const MODE = process.env.MODE ?? 'success';
const HOST = '127.0.0.1';

// In-memory task store (per Section 35: no database).
const tasks = new Map();

/**
 * Compute the deterministic result for the input text. The "correct"
 * result is the SHA-256 hash of the input — a simple, verifiable
 * computation that Genesis can independently check using the G6-01
 * hash-match verification check.
 */
function computeResult(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Compute a WRONG result for the trust-boundary probe. Returns a
 * plausible-looking 64-char hex string that is NOT the correct SHA-256.
 */
function computeWrongResult(input) {
  // Hash a different input to produce a valid-looking but wrong result.
  return createHash('sha256').update(`wrong:${input}`, 'utf8').digest('hex');
}

/** Build the AgentCard served at /.well-known/agent-card.json. */
function agentCard() {
  return {
    name: 'Genesis G6-02 Reference Agent',
    description: 'Bounded local A2A reference agent for G6-02 interoperability probes.',
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false, extensions: [] },
    supportedInterfaces: [
      {
        url: `http://${HOST}:${PORT}/`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
        tenant: '',
      },
    ],
    skills: [
      {
        id: 'deterministic-compute',
        name: 'Deterministic Compute',
        description: 'Computes the SHA-256 hash of the input text.',
        tags: ['compute', 'hash'],
        examples: [],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    securitySchemes: {},
    securityRequirements: [],
    signatures: [],
  };
}

/** Extract text from the A2A Message parts. Handles both wire format (top-level
 * `text` key) and in-memory format (`content: { $case: 'text', value: ... }`). */
function extractText(parts) {
  const texts = [];
  for (const part of parts ?? []) {
    // Wire format: { text: "value", ... }
    if (typeof part.text === 'string') {
      texts.push(part.text);
    }
    // In-memory format: { content: { $case: 'text', value: "value" } }
    else if (part.content?.$case === 'text' && typeof part.content.value === 'string') {
      texts.push(part.content.value);
    }
  }
  return texts.join('\n');
}

/** Build an A2A Task object in the SDK's protobuf JSON wire format. */
function buildTask(id, state, resultText, message) {
  const artifacts =
    resultText === ''
      ? []
      : [
          {
            artifactId: `${id}-result`,
            name: 'Result',
            description: 'Computed result',
            // Part wire format: oneof fields are top-level keys (text, raw, url, data),
            // NOT nested under "content". See Part.fromJSON in the SDK.
            parts: [
              {
                text: resultText,
                filename: '',
                mediaType: 'text/plain',
              },
            ],
            metadata: undefined,
            extensions: [],
          },
        ];
  return {
    id,
    contextId: id,
    status: {
      state: state,
      message: message === undefined ? undefined : message,
      timestamp: new Date().toISOString(),
    },
    artifacts,
    history: [],
    metadata: undefined,
  };
}

/** Handle a JSON-RPC request. */
async function handleJsonRpc(req) {
  const { method, params, id } = req;
  try {
    switch (method) {
      case 'SendMessage': {
        const message = params?.message;
        const inputText = extractText(message?.parts ?? []);
        const taskId = randomUUID();
        let task;
        if (MODE === 'failure') {
          // Probe B: return a failed task.
          task = buildTask(
            taskId,
            4, // TASK_STATE_FAILED
            '',
            {
              messageId: randomUUID(),
              contextId: taskId,
              taskId,
              role: 2, // ROLE_AGENT
              // Part wire format: text is a top-level key, not nested.
              parts: [
                {
                  text: 'reference agent in failure mode — task rejected',
                  filename: '',
                  mediaType: 'text/plain',
                },
              ],
              metadata: undefined,
              extensions: [],
              referenceTaskIds: [],
            },
          );
        } else if (MODE === 'trust-boundary') {
          // Probe C: return a completed task with a WRONG result.
          task = buildTask(taskId, 3, computeWrongResult(inputText));
        } else {
          // Probe A (success): return a completed task with the correct result.
          task = buildTask(taskId, 3, computeResult(inputText));
        }
        tasks.set(taskId, task);
        // The SDK's SendMessageResponse expects a `payload` oneof:
        // { task: Task } or { message: Message }. We return { task: ... }.
        return { jsonrpc: '2.0', result: { task }, id };
      }
      case 'GetTask': {
        const taskId = params?.id;
        const task = tasks.get(taskId);
        if (task === undefined) {
          return {
            jsonrpc: '2.0',
            error: { code: -32602, message: `task not found: ${taskId}` },
            id,
          };
        }
        return { jsonrpc: '2.0', result: task, id };
      }
      case 'CancelTask': {
        const taskId = params?.id;
        const task = tasks.get(taskId);
        if (task === undefined) {
          return {
            jsonrpc: '2.0',
            error: { code: -32602, message: `task not found: ${taskId}` },
            id,
          };
        }
        task.status = {
          state: 5, // TASK_STATE_CANCELED
          message: undefined,
          timestamp: new Date().toISOString(),
        };
        tasks.set(taskId, task);
        return { jsonrpc: '2.0', result: task, id };
      }
      default:
        return {
          jsonrpc: '2.0',
          error: { code: -32601, message: `method not found: ${method}` },
          id,
        };
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      error: { code: -32603, message: `internal error: ${error.message}` },
      id,
    };
  }
}

/** Read the request body as JSON. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data.length === 0 ? {} : JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// Create the HTTP server.
const server = createServer(async (req, res) => {
  // CORS headers (not needed for localhost but harmless).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, A2A-Version');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve the agent card.
  if (req.url === '/.well-known/agent-card.json' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agentCard()));
    return;
  }

  // Handle JSON-RPC POST to /.
  if (req.url === '/' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const response = await handleJsonRpc(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (error) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: `parse error: ${error.message}` },
          id: null,
        }),
      );
    }
    return;
  }

  // 404 for anything else.
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  // Signal readiness on stderr so the test harness can wait for it.
  console.error(`[reference-agent] listening on http://${HOST}:${PORT} mode=${MODE}`);
});

// Graceful shutdown.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
