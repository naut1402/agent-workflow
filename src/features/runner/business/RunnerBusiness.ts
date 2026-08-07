import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import * as runners from './index.js'

/**
 * Facade thao tác runner/connection/credential/job.
 * Domain barrel vẫn là `./index.js` (các hàm export sẵn có).
 */
export class RunnerBusiness extends AbstractBusiness {
  listRunners() {
    return {
      ...runners.listRunners(),
      providers: runners.listProviderCatalog(),
      connections: runners.listConnections(),
    }
  }

  upsertRunner(runner: unknown) {
    return runners.upsertRunner(runner)
  }

  deleteRunner(id: string) {
    return runners.deleteRunner(id)
  }

  setDefaultRunner(id: string) {
    return runners.setDefaultRunner(id)
  }

  listConnections() {
    return {
      connections: runners.listConnections(),
      providers: runners.listProviderCatalog(),
    }
  }

  scanLocalCommands() {
    return runners.scanLocalCommands()
  }

  upsertConnection(connection: unknown) {
    return runners.upsertConnection(connection)
  }

  deleteConnection(id: string) {
    const usedBy = runners
      .listRunners()
      .runners.filter((r) => r.connectionId === id)
      .map((r) => r.id)
    if (usedBy.length) {
      return {
        ok: false as const,
        status: 400,
        error: `connection in use by runners: ${usedBy.join(', ')}`,
      }
    }
    return runners.deleteConnection(id)
  }

  listCustomCommands() {
    return { commands: runners.listCustomCommands() }
  }

  upsertCustomCommand(command: unknown) {
    return runners.upsertCustomCommand(command)
  }

  deleteCustomCommand(id: string) {
    return runners.deleteCustomCommand(id)
  }

  listCredentials() {
    return { profiles: runners.listCredentials() }
  }

  upsertCredential(profile: unknown) {
    return runners.upsertCredential(profile)
  }

  deleteCredential(id: string) {
    return runners.deleteCredential(id)
  }

  loadJob(id: string) {
    return runners.loadJob(id)
  }

  listJobs(limit: number) {
    return runners.listJobs(limit)
  }

  submitJob(input: Parameters<typeof runners.submitJob>[0]) {
    return runners.submitJob(input)
  }

  cancelJob(id: string) {
    return runners.cancelJob(id)
  }

  getApprovalDiff(id: string) {
    return runners.getApprovalDiff(id)
  }

  approveJob(id: string) {
    return runners.approveJob(id)
  }

  discardJob(id: string) {
    return runners.discardJob(id)
  }

  sendJobFeedback(id: string, feedback: string) {
    return runners.sendJobFeedback(id, feedback)
  }
}
