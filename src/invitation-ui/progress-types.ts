/** Presentation-only optional progress metadata; does not install or invoke anything. */
export type BrowserInstallProgress = {
  stage: 'downloading' | 'verifying' | 'installing' | 'ready'
  downloaded: number
  total: number | null
}
export type BrowserInstallState = BrowserInstallProgress & { error?: string }
