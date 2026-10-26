// supervisorOrchestrator.ts
import * as fs from 'fs';
import * as path from 'path';

// Standardized Driver Interface
export interface IntegrationDriver {
  executeIntegration: (payload: Record<string, any>) => Promise<Record<string, any>>;
}

// Directed Graph Execution Step
export interface WorkflowStep {
  stepKey: string;
  driverKey: string;
  dependsOn?: string[];
  inputPayload?: Record<string, any>;
}

export interface WorkflowDefinition {
  workflowId: string;
  steps: WorkflowStep[];
}

export interface DriverResponse {
  success: boolean;
  driverKey: string;
  executionId: string;
  payload?: Record<string, any>;
  error?: string;
}

export class SupervisorOrchestrator {
  private generatedDir: string;

  constructor(customDir?: string) {
    this.generatedDir = customDir || path.join(__dirname, 'generated_integrations');
  }

  /**
   * 1. Discover all compiled drivers available in disk registry
   */
  public listAvailableDrivers(): string[] {
    if (!fs.existsSync(this.generatedDir)) return [];
    return fs
      .readdirSync(this.generatedDir)
      .filter((file) => file.endsWith('_driver.ts'))
      .map((file) => file.replace('_driver.ts', ''));
  }

  /**
   * 2. Dynamically import and execute a compiled driver module with ESM cache-busting
   */
  public async runDriver(driverKey: string, payload: Record<string, any>): Promise<DriverResponse> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const filename = `${driverKey.toLowerCase()}_driver.ts`;
    const driverPath = path.join(this.generatedDir, filename);

    if (!fs.existsSync(driverPath)) {
      return {
        success: false,
        driverKey,
        executionId,
        error: `Driver '${driverKey}' not found at path: ${driverPath}`,
      };
    }

    try {
      // ✅ Bypasses Node.js module caching using query parameter timestamp
      const moduleUrl = `file://${driverPath}?ts=${Date.now()}`;
      const module: IntegrationDriver = await import(moduleUrl);

      if (typeof module.executeIntegration !== 'function') {
        throw new Error(`Driver '${driverKey}' does not export executeIntegration()`);
      }

      console.log(`🚀 [Supervisor] Executing compiled driver: ${driverKey} (${executionId})`);
      const result = await module.executeIntegration(payload);

      return {
        success: true,
        driverKey,
        executionId,
        payload: result,
      };
    } catch (err: any) {
      console.error(`❌ [Supervisor] Execution fault in driver '${driverKey}':`, err.message);
      return {
        success: false,
        driverKey,
        executionId,
        error: err.message || String(err),
      };
    }
  }

  /**
   * 3. Executes graph workflows with dependency checks and error isolation
   */
  public async runWorkflow(
    workflow: WorkflowDefinition,
    initialPayload: Record<string, any>
  ): Promise<Record<string, DriverResponse>> {
    const workflowResults: Record<string, DriverResponse> = {};
    const cumulativeContext = { ...initialPayload };

    for (const step of workflow.steps) {
      // Verify dependency completion
      if (step.dependsOn) {
        const missingDependency = step.dependsOn.find(
          (depKey) => !workflowResults[depKey] || !workflowResults[depKey].success
        );

        if (missingDependency) {
          console.warn(
            `⚠️ [Supervisor] Skipping step '${step.stepKey}' due to failed dependency: '${missingDependency}'`
          );
          workflowResults[step.stepKey] = {
            success: false,
            driverKey: step.driverKey,
            executionId: `skipped_${Date.now()}`,
            error: `Prerequisite dependency failed: ${missingDependency}`,
          };
          continue;
        }
      }

      // Merge initial context with previous execution state
      const stepPayload = {
        ...cumulativeContext,
        ...(step.inputPayload || {}),
        _previousResults: workflowResults,
      };

      console.log(`\n📌 [Supervisor] Running Step '${step.stepKey}' -> Driver '${step.driverKey}'`);
      const response = await this.runDriver(step.driverKey, stepPayload);
      workflowResults[step.stepKey] = response;

      if (response.success && response.payload) {
        cumulativeContext[step.stepKey] = response.payload;
      }
    }

    return workflowResults;
  }
}