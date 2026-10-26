'use strict';

const ts = require('typescript');
const MAX_LOG_BYTES = 32 * 1024;

function formatLogArgs(args) {
  return args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');
}

process.on('message', async (request) => {
  const logs = [];
  let logBytes = 0;

  const appendLog = (line) => {
    const remaining = MAX_LOG_BYTES - logBytes;
    if (remaining <= 0) return;
    const boundedLine = line.slice(0, remaining);
    logs.push(boundedLine);
    logBytes += Buffer.byteLength(boundedLine, 'utf8');
  };

  try {
    const transpiled = ts.transpileModule(request.sourceCode, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: true,
    });
    const errors = (transpiled.diagnostics || [])
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

    if (errors.length > 0) {
      throw new Error(
        errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n')
      );
    }

    const exportsObject = {};
    const moduleObject = { exports: exportsObject };
    const restrictedRequire = () => {
      throw new Error('Module loading is disabled in the dry-run worker.');
    };
    const workerConsole = {
      log: (...args) => appendLog(formatLogArgs(args)),
      warn: (...args) => appendLog(`WARN: ${formatLogArgs(args)}`),
      error: (...args) => appendLog(`ERROR: ${formatLogArgs(args)}`),
    };

    const executeModule = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      'console',
      transpiled.outputText
    );
    executeModule(exportsObject, restrictedRequire, moduleObject, '<generated-driver>', '', workerConsole);

    const executeIntegration = exportsObject.executeIntegration;
    if (typeof executeIntegration !== 'function') {
      throw new Error('Generated driver does not export executeIntegration().');
    }

    await Promise.resolve(executeIntegration(request.mockPayload));
    process.send?.({ success: true, logs });
  } catch (error) {
    process.send?.({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      logs,
    });
  } finally {
    process.disconnect?.();
  }
});
