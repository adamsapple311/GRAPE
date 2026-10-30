// agentLoop.ts
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { fork } from 'child_process';
import { randomUUID } from 'crypto';
import * as ts from 'typescript';
import { performance } from 'perf_hooks';

dotenv.config();

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

function assertSupabaseClient() {
  if (!supabase) {
    throw new Error(
      'Supabase environment variables SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured before starting the agent loop.'
    );
  }

  return supabase;
}

function validateStartupEnvironment(): void {
  if (LLM_PROVIDER !== 'gemini' && LLM_PROVIDER !== 'ollama') {
    throw new Error(
      `Unsupported LLM_PROVIDER "${LLM_PROVIDER}". Supported providers: "gemini", "ollama".`
    );
  }

  const requiredKeys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  if (LLM_PROVIDER === 'gemini') {
    requiredKeys.push('GEMINI_API_KEY');
  }

  const missing = requiredKeys
    .filter((key) => !process.env[key] || process.env[key]?.trim() === '');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}.` +
      ' Configure them before starting the agent loop.'
    );
  }
}

// Enforce explicit local loopback IP and Ollama port to bypass network route confusion
const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
const MODEL_NAME = 'deepseek-r1:1.5b';

// Generation provider selection: "gemini" (default, cloud) or "ollama" (local DeepSeek-R1)
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
const GEMINI_MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GEMINI_TIMEOUT_MS = 120000; // 120s cap so a stalled generation cannot hold a lease indefinitely

// Orchestration Parameters
const POLLING_INTERVAL_MS = 5000; // 5-second cooldown interval
const MAX_RETRIES = 3;             // Fail limit threshold before marking record 'FAILED'
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;
const LEASE_DURATION_SECONDS = 90;
const LEASE_RENEWAL_INTERVAL_MS = 20000;
const DRIVER_SANDBOX_TIMEOUT_MS = 5000;
const MAX_DRIVER_SOURCE_BYTES = 256 * 1024;
const MAX_SANDBOX_PAYLOAD_BYTES = 256 * 1024;

const workerUuid = randomUUID();
let isRunning = true;

function calculateRetryDelayMs(attemptNumber: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attemptNumber - 1), RETRY_MAX_DELAY_MS);
}

/**
 * Helper to allow the event loop breathing room during cooldowns.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeAndValidateDriver(rawCode: string): { cleanedCode: string; requiresDegradedFlag: boolean } {
  const cleanedCode = rawCode.trim();
  const sourceFile = ts.createSourceFile(
    'generated-driver.ts',
    cleanedCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const position = diagnostic.start === undefined
      ? ''
      : ` at ${sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line + 1}:${sourceFile.getLineAndCharacterOfPosition(diagnostic.start).character + 1}`;
    throw new Error(`Generated TypeScript has a syntax error${position}: ${message}`);
  }

  const unexpectedStatement = sourceFile.statements.find(
    (statement) =>
      !ts.isFunctionDeclaration(statement) &&
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement)
  );
  if (unexpectedStatement) {
    throw new Error('Generated driver may contain only function, interface, and type declarations at top level.');
  }

  const declarations = sourceFile.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'executeIntegration'
  );

  if (
    declarations.length !== 1 ||
    !declarations[0].modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
    declarations[0].modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  ) {
    throw new Error('Generated driver must declare exactly one named export function executeIntegration().');
  }

  const executeIntegration = declarations[0];
  if (
    !executeIntegration.body ||
    executeIntegration.parameters.length !== 1 ||
    !ts.isIdentifier(executeIntegration.parameters[0].name) ||
    executeIntegration.parameters[0].name.text !== 'payload' ||
    executeIntegration.parameters[0].questionToken ||
    executeIntegration.parameters[0].dotDotDotToken ||
    executeIntegration.parameters[0].initializer
  ) {
    throw new Error('executeIntegration must accept exactly one required parameter named payload.');
  }

  let forbiddenNode: ts.Node | undefined;
  const forbiddenIdentifiers = new Set([
    'process',
    'require',
    'fetch',
    'globalThis',
    'eval',
    'Function',
    'WebAssembly',
    'Deno',
    'Bun',
  ]);
  const forbiddenProperties = new Set(['constructor', 'prototype', '__proto__']);

  const inspect = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node) && forbiddenIdentifiers.has(node.text) ||
      ts.isPropertyAccessExpression(node) && forbiddenProperties.has(node.name.text) ||
      ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        forbiddenProperties.has(node.argumentExpression.text) ||
      node.kind === ts.SyntaxKind.ThisKeyword
    ) {
      forbiddenNode = node;
      return;
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);

  if (forbiddenNode) {
    const position = sourceFile.getLineAndCharacterOfPosition(forbiddenNode.getStart(sourceFile));
    throw new Error(
      `Generated driver uses a capability unavailable to the restricted dry-run worker at ${position.line + 1}:${position.character + 1}.`
    );
  }

  return {
    cleanedCode,
    requiresDegradedFlag: false,
  };
}

/**
 * Native HTTP Request Stream Bypass
 * Completely forces a direct connection to 127.0.0.1:11434 bypassing global system proxies
 */
async function callDeepSeekStream(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: MODEL_NAME,
      prompt: prompt,
      stream: true,
    });

    const options = {
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    process.stdout.write('\n🤖 [DEEPSEEK-R1 STREAMING INFERENCE VIA DIRECT BYPASS] 🚀\n');

    const req = http.request(options, (res) => {
      let fullResponse = '';
      let buffer = '';

      res.setEncoding('utf-8');
      
      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        
        // Keep the last partial line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              process.stdout.write(parsed.response);
              fullResponse += parsed.response;
            }
          } catch (err) {
            // Fragmented line safety
          }
        }
      });

      res.on('end', () => {
        process.stdout.write('\n\n[INFERENCE STREAM END]\n');
        resolve(fullResponse);
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Ollama direct connection failed: ${e.message}`));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Gemini generation (cloud provider).
 * Returns the model's raw text output; code-block extraction and all
 * downstream guardrails are shared with the Ollama path.
 */
async function callGeminiGenerate(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('GEMINI_API_KEY must be configured when LLM_PROVIDER is "gemini".');
  }

  const ai = new GoogleGenAI({ apiKey });

  process.stdout.write(`\n\u{1F916} [GEMINI GENERATION: ${GEMINI_MODEL_NAME}] \u{1F680}\n`);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Gemini generation exceeded the ${GEMINI_TIMEOUT_MS}ms timeout.`));
    }, GEMINI_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: GEMINI_MODEL_NAME,
        contents: prompt,
        config: { abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS) },
      }),
      timeoutPromise,
    ]);

    const text = response.text;
    if (!text || text.trim() === '') {
      throw new Error('Gemini returned an empty response.');
    }

    process.stdout.write(text);
    process.stdout.write('\n\n[GEMINI GENERATION END]\n');
    return text;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Provider dispatcher: routes generation to the configured LLM provider.
 * Both providers return raw model text into the same extraction path.
 */
async function generateDriverSource(prompt: string): Promise<string> {
  return LLM_PROVIDER === 'ollama' ? callDeepSeekStream(prompt) : callGeminiGenerate(prompt);
}

async function dryRunDriverInChild(
  sourceCode: string,
  mockPayload: Record<string, any>
): Promise<{ success: boolean; error?: string; logs: string[] }> {
  if (Buffer.byteLength(sourceCode, 'utf8') > MAX_DRIVER_SOURCE_BYTES) {
    throw new Error(`Generated driver exceeds the ${MAX_DRIVER_SOURCE_BYTES}-byte source limit.`);
  }

  const serializedPayload = JSON.stringify(mockPayload);
  if (Buffer.byteLength(serializedPayload, 'utf8') > MAX_SANDBOX_PAYLOAD_BYTES) {
    throw new Error(`Dry-run payload exceeds the ${MAX_SANDBOX_PAYLOAD_BYTES}-byte limit.`);
  }

  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'driverSandboxWorker.cjs');
    // A fork separates failures and strips secrets from env, but inherits this OS account's permissions.
    const child = fork(workerPath, [], {
      execArgv: [],
      env: {
        PATH: process.env.PATH || '',
        SystemRoot: process.env.SystemRoot || '',
        WINDIR: process.env.WINDIR || '',
        TEMP: process.env.TEMP || '',
        TMP: process.env.TMP || '',
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'json',
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Driver dry-run exceeded ${DRIVER_SANDBOX_TIMEOUT_MS}ms and was terminated.`));
    }, DRIVER_SANDBOX_TIMEOUT_MS);

    child.once('message', (message: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (!message || typeof message.success !== 'boolean' || !Array.isArray(message.logs)) {
        reject(new Error('Dry-run worker returned an invalid response.'));
        return;
      }
      resolve(message);
    });

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Failed to start driver dry-run worker: ${error.message}`));
    });

    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Driver dry-run worker exited without a result (code=${code}, signal=${signal}).`));
    });

    child.send({ sourceCode, mockPayload: JSON.parse(serializedPayload) }, (error) => {
      if (!error || settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(new Error(`Failed to send driver source to dry-run worker: ${error.message}`));
    });
  });
}

function startLeaseHeartbeat(
  client: ReturnType<typeof assertSupabaseClient>,
  recordId: number
): { stop: () => Promise<void> } {
  let renewalInFlight: Promise<void> | null = null;
  let renewalFailure: Error | null = null;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped || renewalInFlight || renewalFailure) return;
    renewalInFlight = Promise.resolve(
      client
        .from('agent_roi_insights')
        .update({ lease_expires_at: new Date(Date.now() + LEASE_DURATION_SECONDS * 1000).toISOString() })
        .eq('id', recordId)
        .eq('status', 'CLAIMED')
        .eq('worker_uuid', workerUuid)
        .gt('lease_expires_at', new Date().toISOString())
        .select('id')
        .maybeSingle()
    )
      .then(({ data, error }) => {
        if (error) throw new Error(`Lease renewal failed: ${error.message}`);
        if (!data) throw new Error(`Lease for task ${recordId} is no longer owned by worker ${workerUuid}.`);
      })
      .catch((error: unknown) => {
        renewalFailure = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ ${renewalFailure.message}`);
      })
      .finally(() => {
        renewalInFlight = null;
      });
  }, LEASE_RENEWAL_INTERVAL_MS);

  return {
    stop: async () => {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
      }
      if (renewalInFlight) await renewalInFlight;
      if (renewalFailure) throw renewalFailure;
    },
  };
}

/**
 * Enhanced Integration Agent Code Generator with Telemetry & SLA Tracking
 */
export async function runIntegrationAgent(
  targetInsight: any,
  leaseOwner: string,
  stopLeaseRenewal: () => Promise<void>
): Promise<void> {
  const startTime = performance.now();
  
  const markerKey = 
    targetInsight.operational_action || 
    targetInsight.workflow_marker || 
    'AUTOMATION_FOR_INVOICE_REASSIGNEDS';
  
  console.log(`🎯 Processing Row Entry: [ID: ${targetInsight.id}] -> Target Key: ${markerKey}`);

  const prompt = `You are a core architecture subsystem module inside GenAgents. 
Analyze this historical telemetry state row parameter to compile a clean, standalone TypeScript integration driver.

WORKFLOW TARGET ANCHOR: "${markerKey}"
METRIC CONTEXT: ${JSON.stringify(targetInsight)}

TASK EXECUTION PARAMETERS:
- Generate a standalone executable TypeScript function named \`executeIntegration\`.
- Use console logging only; do not import modules, access process or network APIs, or read/write files.
- Accept exactly one required parameter named \`payload\`.
- Output pure TypeScript code enclosed strictly in markdown blocks (\`\`\`typescript ... \`\`\`). Do not add conversational explanations outside of the code block.`;

  try {
    const rawOutput = await generateDriverSource(prompt);

    const codeBlockRegex = /```typescript([\s\S]*?)```/;
    const match = rawOutput.match(codeBlockRegex);
    
    let compiledCode = '';
    let driftStatus = 'OPTIMAL';

    if (match && match[1]) {
      compiledCode = match[1].trim();
    } else {
      compiledCode = rawOutput.replace(/<think>[\s\S]*?<\/think>/, '').trim();
      driftStatus = 'DEGRADED';
    }

    // 🛡️ AST SANITIZER & GUARDRAIL PASS
    const { cleanedCode, requiresDegradedFlag } = sanitizeAndValidateDriver(compiledCode);
    if (requiresDegradedFlag && driftStatus === 'OPTIMAL') {
      driftStatus = 'DEGRADED';
    }

    // Generated code runs in a separate process with no service credentials in its environment.
    console.log(`🛡️ [Child Process] Running bounded dry-run...`);
    const sandboxPayload = {
      id: targetInsight.id,
      target_table: targetInsight.target_table,
      associated_entity: targetInsight.associated_entity,
      operational_action: targetInsight.operational_action,
      correlated_financial_volume: targetInsight.correlated_financial_volume,
      roi_priority_rank: targetInsight.roi_priority_rank,
      workflow_marker: targetInsight.workflow_marker,
    };
    const sandboxResult = await dryRunDriverInChild(cleanedCode, sandboxPayload);
    if (!sandboxResult.success) {
      throw new Error(
        `Driver dry-run validation failed: ${sandboxResult.error || 'Unknown validation error'}\n` +
          sandboxResult.logs.join('\n')
      );
    }

    console.log(`✅ [Sandbox] Dry-run passed cleanly. Logs captured: ${sandboxResult.logs.length}`);

    // Write sanitized file to disk
    const outputDir = path.join(__dirname, 'generated_integrations');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const sanitizedFilenameKey = markerKey.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const filename = `${sanitizedFilenameKey}_driver.ts`;
    const outputPath = path.join(outputDir, filename);

    const client = assertSupabaseClient();
    const { data: ownedTask, error: ownershipError } = await client
      .from('agent_roi_insights')
      .select('id')
      .eq('id', targetInsight.id)
      .eq('status', 'CLAIMED')
      .eq('worker_uuid', leaseOwner)
      .gt('lease_expires_at', new Date().toISOString())
      .maybeSingle();

    if (ownershipError) {
      throw new Error(`Failed to verify queue lease before artifact persistence: ${ownershipError.message}`);
    }
    if (!ownedTask) {
      throw new Error(`Queue lease for task ${targetInsight.id} was lost before artifact persistence.`);
    }

    fs.writeFileSync(outputPath, cleanedCode, 'utf-8');
    console.log(`💾 System Integration Code compiled & sanitized to disk: ${outputPath}`);
   
    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);

    await stopLeaseRenewal();
    const { data: completedTask, error: updateError } = await client
      .from('agent_roi_insights')
      .update({ 
        status: 'COMPILED', 
        processed_at: new Date().toISOString(),
        execution_duration_ms: durationMs,
        drift_status: driftStatus,
        error_logs: null,
        worker_uuid: null,
        lease_expires_at: null,
        retry_count: 0,
        next_retry_at: null,
      })
      .eq('id', targetInsight.id)
      .eq('status', 'CLAIMED')
      .eq('worker_uuid', leaseOwner)
      .gt('lease_expires_at', new Date().toISOString())
      .select('id')
      .maybeSingle();

    if (updateError || !completedTask) {
      throw new Error(
        `Failed to complete queue task in Supabase: ${updateError?.message || 'Queue lease was lost before completion.'}`
      );
    } else {
      console.log(`📊 SLA Telemetry Logged -> Duration: ${durationMs}ms | Drift: ${driftStatus} | Status: 'COMPILED'`);
    }

  } catch (error: any) {
    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);
    const errorTrace = error?.message || String(error);

    try {
      const client = assertSupabaseClient();
      await client
        .from('agent_roi_insights')
        .update({
          execution_duration_ms: durationMs,
          drift_status: 'CRITICAL',
          error_logs: errorTrace,
          processed_at: new Date().toISOString()
        })
        .eq('id', targetInsight.id)
        .eq('status', 'CLAIMED')
        .eq('worker_uuid', leaseOwner);
    } catch (telemetryError) {
      console.error('⚠️ Failed to write telemetry for failed integration:', telemetryError);
    }

    throw error;
  }
}

/**
 * Autonomous Master Platform Lifecycle Controller
 */
async function main() {
  console.log('🚀 Starting GenAgents Autonomous Orchestration Engine...');
  console.log(
    `🧠 Generation provider: ${LLM_PROVIDER} (${LLM_PROVIDER === 'gemini' ? GEMINI_MODEL_NAME : MODEL_NAME})`
  );

  validateStartupEnvironment();
  const client = assertSupabaseClient();

  const shutdownHandler = () => {
    console.log('\n🛑 Shutdown signal received. Gracefully exiting loop...');
    isRunning = false;
  };
  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);

  while (isRunning) {
    try {
      const { data: claimedRows, error: claimError } = await client.rpc(
        'claim_next_agent_roi_insight',
        {
          p_worker_uuid: workerUuid,
          p_lease_seconds: LEASE_DURATION_SECONDS,
        }
      );

      if (claimError) {
        console.error(
          '❌ Queue claim RPC failed. Apply the agent ROI lease migration before starting workers:',
          claimError.message
        );
        await sleep(POLLING_INTERVAL_MS);
        continue;
      }

      const currentTask = claimedRows?.[0];
      if (!currentTask) {
        process.stdout.write('😴 Queue empty. Polling for pending jobs...\r');
        await sleep(POLLING_INTERVAL_MS);
        continue;
      }

      const recordId = currentTask.id;
      console.log(`\n\n⚡ Task Claimed: [ID: ${recordId}] | Worker: ${workerUuid}`);
      const leaseHeartbeat = startLeaseHeartbeat(client, recordId);

      try {
        await runIntegrationAgent(currentTask, workerUuid, leaseHeartbeat.stop);
        await leaseHeartbeat.stop();
        console.log(`🎉 Cycle completed successfully for task ID: ${recordId}`);
      } catch (executionError: any) {
        try {
          await leaseHeartbeat.stop();
        } catch (leaseError) {
          console.error(`⚠️ Could not confirm lease release for task ${recordId}:`, leaseError);
        }

        const currentFailures = (Number(currentTask.retry_count) || 0) + 1;
        const isFinalAttempt = currentFailures >= MAX_RETRIES;
        const retryDelayMs = calculateRetryDelayMs(currentFailures);
        const retryAt = new Date(Date.now() + retryDelayMs).toISOString();

        console.error(
          `⚠️ Failure executing Task ID ${recordId} (Attempt ${currentFailures}/${MAX_RETRIES}):`,
          executionError?.message || executionError
        );

        if (isFinalAttempt) {
          console.error(`🚨 Task ID ${recordId} exceeded maximum retries. Updating status to 'FAILED'.`);
        }

        const { data: releasedTask, error: releaseError } = await client
          .from('agent_roi_insights')
          .update({
            status: isFinalAttempt ? 'FAILED' : 'PENDING',
            retry_count: currentFailures,
            next_retry_at: isFinalAttempt ? null : retryAt,
            worker_uuid: null,
            lease_expires_at: null,
            processed_at: isFinalAttempt ? new Date().toISOString() : null,
            error_logs: executionError?.message || String(executionError),
          })
          .eq('id', recordId)
          .eq('status', 'CLAIMED')
          .eq('worker_uuid', workerUuid)
          .select('id')
          .maybeSingle();

        if (releaseError) {
          console.error(`❌ Failed to release task ${recordId} after error:`, releaseError.message);
        } else if (!releasedTask) {
          console.error(`⚠️ Task ${recordId} is no longer leased by this worker; leaving its current state unchanged.`);
        } else if (isFinalAttempt) {
          console.log(`🔒 Task ID ${recordId} permanently marked as 'FAILED'. Moving to next queue item.`);
        } else {
          console.warn(
            `🧯 Task ID ${recordId} will retry in ${retryDelayMs}ms after failure ${currentFailures}/${MAX_RETRIES}.`
          );
        }
      }

    } catch (criticalLoopError) {
      console.error('🔥 Unexpected top-level loop fault:', criticalLoopError);
    }

    if (isRunning) {
      await sleep(POLLING_INTERVAL_MS);
    }
  }

  console.log('👋 GenAgents Runtime Loop terminated gracefully.');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void main().catch((error) => {
    console.error('💥 Fatal startup error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
