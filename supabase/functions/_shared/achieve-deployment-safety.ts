const ACHIEVE_PRODUCTION_SUPABASE_URL = 'https://miikotqnovnixpeqtqnd.supabase.co'

/** Inputs required before any Achieve provider or delivery side effect. */
export type AchieveExternalIoBoundary = {
  readonly deploymentEnvironment: 'production' | 'staging'
  readonly externalIoEnabled: boolean
  readonly supabaseUrl: string
}

/** Allow external I/O only for the explicitly enabled production project. */
export function isAchieveExternalIoAllowed(boundary: AchieveExternalIoBoundary): boolean {
  return boundary.deploymentEnvironment === 'production'
    && boundary.externalIoEnabled
    && boundary.supabaseUrl === ACHIEVE_PRODUCTION_SUPABASE_URL
}
