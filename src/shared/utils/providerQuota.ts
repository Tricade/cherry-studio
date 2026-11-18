export function supportsProviderQuota(providerId: string): boolean {
  return providerId === 'openai-codex' || providerId === 'claude-code' || providerId === 'cherryin'
}
