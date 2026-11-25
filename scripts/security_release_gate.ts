/**
 * DUALAI - Pre-Release Automated Security Gate (CARD-17)
 * Empirically scans:
 * 1. Git tracked index & staged files (zero .env/vault/key files, zero live API keys or private keys)
 * 2. Compiled Electron desktop bundles in out/ (zero provider secrets or direct upstream endpoints)
 * Exits with code 0 only when 100% clean.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SecurityGateReport {
  passed: boolean
  gitFilesScanned: number
  stagedFilesChecked: number
  bundleFilesScanned: number
  violations: string[]
}

const FORBIDDEN_GIT_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env($|\.(?!example$))/i,
  /(^|\/)dualai-session\.vault$/i,
  /\.(pem|key|p12|pfx|jks)$/i
]

const LIVE_SECRET_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'Private Key Block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'Live Google/Gemini API Key', regex: /\bAIzaSy[0-9A-Za-z\-_]{20,}\b/ },
  { label: 'Live Stripe/OpenAI Secret Key', regex: /\bsk-(?:live|proj)-[0-9A-Za-z]{20,}\b/ },
  { label: 'Live GitHub Token', regex: /\bgh[pousr]_[0-9A-Za-z]{25,}\b/ },
  { label: 'Live AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    label: 'Hardcoded Provider Secret Assignment',
    regex:
      /\b(?:SONIOX_API_KEY|DEEPGRAM_API_KEY|GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|MS_STORE_CLIENT_SECRET|BILLING_WEBHOOK_SECRET)\s*=\s*["']?(?!your_|changeme|dualai_test_)[A-Za-z0-9\-_.]{24,}["']?/
  }
]

const FORBIDDEN_BUNDLE_STRINGS: string[] = [
  'SONIOX_API_KEY',
  'DEEPGRAM_API_KEY',
  'GEMINI_API_KEY',
  'VITE_SONIOX_API_KEY',
  'VITE_DEEPGRAM_API_KEY',
  'VITE_GEMINI_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MS_STORE_CLIENT_SECRET',
  'BILLING_WEBHOOK_SECRET',
  'stt-rt.soniox.com',
  'api.deepgram.com',
  'generativelanguage.googleapis.com'
]

const TEXT_FILE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|sql|md|sh|html|css|env\.example)$/i

function walkBundleFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkBundleFiles(full))
    } else if (entry.isFile() && /\.(js|mjs|cjs|html|css)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function listGitPaths(args: string[]): string[] {
  try {
    const raw = execFileSync('git', args, { encoding: 'utf-8' })
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function runPreReleaseSecurityGate(): SecurityGateReport {
  const violations: string[] = []

  // 1. Scan Git tracked index + staged files
  const trackedFiles = listGitPaths(['ls-files'])
  const stagedFiles = listGitPaths(['diff', '--cached', '--name-only', '--diff-filter=ACM'])
  const combinedGitFiles = Array.from(new Set([...trackedFiles, ...stagedFiles]))

  for (const relPath of combinedGitFiles) {
    for (const forbiddenFileRe of FORBIDDEN_GIT_FILE_PATTERNS) {
      if (forbiddenFileRe.test(relPath)) {
        violations.push(`Forbidden secret/vault file in git index or staging: ${relPath}`)
      }
    }

    if (!TEXT_FILE_EXT.test(relPath)) continue
    const absPath = path.resolve(relPath)
    if (!fs.existsSync(absPath)) continue

    // Skip this gate script's own regex definitions
    if (relPath === 'scripts/security_release_gate.ts') continue

    const content = fs.readFileSync(absPath, 'utf-8')
    for (const pattern of LIVE_SECRET_PATTERNS) {
      if (pattern.regex.test(content)) {
        violations.push(`Potential ${pattern.label} detected in git-tracked file: ${relPath}`)
      }
    }
  }

  // 2. Scan compiled Electron desktop bundles in out/
  const bundleFiles = walkBundleFiles(path.resolve('out'))
  if (bundleFiles.length < 3) {
    violations.push(
      'Compiled Electron bundle missing in out/ (run "pnpm run build" before release gate).'
    )
  }

  for (const file of bundleFiles) {
    const content = fs.readFileSync(file, 'utf-8')
    const rel = path.relative(process.cwd(), file)

    for (const forbiddenStr of FORBIDDEN_BUNDLE_STRINGS) {
      if (content.includes(forbiddenStr)) {
        violations.push(`Forbidden secret/upstream string "${forbiddenStr}" in compiled bundle: ${rel}`)
      }
    }

    for (const pattern of LIVE_SECRET_PATTERNS) {
      if (pattern.regex.test(content)) {
        violations.push(`Potential ${pattern.label} leaked into compiled bundle: ${rel}`)
      }
    }
  }

  return {
    passed: violations.length === 0,
    gitFilesScanned: combinedGitFiles.length,
    stagedFilesChecked: stagedFiles.length,
    bundleFilesScanned: bundleFiles.length,
    violations
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])

if (isDirectRun) {
  console.log('==================================================================')
  console.log('DUALAI PRE-RELEASE SECURITY GATE (GIT INDEX + ELECTRON BUNDLES)')
  console.log('==================================================================')

  const report = runPreReleaseSecurityGate()
  console.log(`  Git index files scanned:      ${report.gitFilesScanned}`)
  console.log(`  Git staged files checked:     ${report.stagedFilesChecked}`)
  console.log(`  Compiled out/ files scanned:  ${report.bundleFilesScanned}`)

  if (!report.passed) {
    console.error('\nSECURITY GATE FAILED:')
    for (const v of report.violations) {
      console.error(`  - ${v}`)
    }
    process.exit(1)
  }

  console.log('\nPASS: Zero secrets in git index, staged files, and compiled out/ bundles.')
  console.log('==================================================================')
}
