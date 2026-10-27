// Shared log-level colour/label maps for the logs viewer rows.

export const LEVEL_COLORS: Record<string, string> = {
  DEBUG: '#9ca3af',
  INFO: '#e5e7eb',
  WARNING: '#fbbf24',
  ERROR: 'var(--danger)',
  CRITICAL: '#ff6b6b',
}

export const LEVEL_BG: Record<string, string> = {
  DEBUG: 'transparent',
  INFO: 'transparent',
  WARNING: 'rgba(251,191,36,0.07)',
  ERROR: 'rgba(248,113,113,0.09)',
  CRITICAL: 'rgba(255,107,107,0.14)',
}

export const LEVEL_LABELS: Record<string, string> = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
}
