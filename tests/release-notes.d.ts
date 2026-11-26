declare module '*/release-notes.cjs' {
  export function extractSection(changelog: string, version: string): string | null
  export function releaseNotes(rootDir?: string): string
}
