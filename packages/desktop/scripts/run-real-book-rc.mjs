import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const markerName = '.leafbook-real-book-rc-runner'
const tempPrefix = path.join(os.tmpdir(), 'leafbook-real-book-rc-runner-')
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const maxCapturedBytesPerStream = 256 * 1024
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
const signalState = { requested: null, count: 0, child: null }
const handleSignal = (signal) => {
  signalState.count++
  signalState.requested ||= signal
  if (signalState.child) {
    signalState.child.kill(signalState.count === 1 ? signal : 'SIGKILL')
  }
}
for (const signal of signals) process.on(signal, handleSignal)
const releaseSignalHandlers = () => {
  for (const signal of signals) process.removeListener(signal, handleSignal)
}

const readMarker = async (markerPath) => {
  const noFollow = fs.constants.O_NOFOLLOW
  if (typeof noFollow !== 'number') throw new Error('runner-marker-nofollow')
  const handle = await fs.open(
    markerPath,
    fs.constants.O_RDONLY | noFollow | fs.constants.O_NONBLOCK
  )
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== 32) {
      throw new Error('runner-marker-shape')
    }
    const marker = Buffer.alloc(32)
    const { bytesRead } = await handle.read(marker, 0, 32, 0)
    const [after, pathAfter] = await Promise.all([handle.stat(), fs.lstat(markerPath)])
    if (
      bytesRead !== 32 ||
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      after.size !== stat.size ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      pathAfter.nlink !== 1 ||
      pathAfter.dev !== stat.dev ||
      pathAfter.ino !== stat.ino ||
      pathAfter.size !== stat.size
    ) {
      throw new Error('runner-marker-changed')
    }
    return marker
  } finally {
    await handle.close()
  }
}

const validateRunnerRoot = async (root, marker) => {
  const [real, canonicalTemp, stat, actualMarker] = await Promise.all([
    fs.realpath(root),
    fs.realpath(os.tmpdir()),
    fs.lstat(root),
    readMarker(path.join(root, markerName))
  ])
  return (
    real === root &&
    real.startsWith(path.join(canonicalTemp, 'leafbook-real-book-rc-runner-')) &&
    stat.isDirectory() &&
    actualMarker.equals(marker) &&
    (!('uid' in stat) || typeof process.getuid !== 'function' || stat.uid === process.getuid())
  )
}

const createRunnerRoot = async () => {
  const created = await fs.mkdtemp(tempPrefix)
  try {
    const root = await fs.realpath(created)
    const marker = randomBytes(32)
    const stat = await fs.lstat(root)
    const canonicalTemp = await fs.realpath(os.tmpdir())
    if (
      !root.startsWith(path.join(canonicalTemp, 'leafbook-real-book-rc-runner-')) ||
      !stat.isDirectory() ||
      ('uid' in stat && typeof process.getuid === 'function' && stat.uid !== process.getuid())
    ) {
      throw new Error('runner-root-validation')
    }
    await fs.writeFile(path.join(root, markerName), marker, { flag: 'wx', mode: 0o600 })
    return { root, marker }
  } catch {
    await fs.rm(created, { recursive: true }).catch(() => undefined)
    throw new Error('runner-root-creation')
  }
}

const removeRunnerRoot = async ({ root, marker }) => {
  if (!(await validateRunnerRoot(root, marker))) throw new Error('runner-cleanup-validation')
  await fs.rm(root, { recursive: true })
  try {
    await fs.lstat(root)
  } catch (error) {
    if (error?.code === 'ENOENT') return
  }
  throw new Error('runner-cleanup-incomplete')
}

const runChild = (command, args, envOverrides = {}, afterSpawn) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: desktopRoot,
      env: { ...process.env, PLAYWRIGHT_NO_COPY_PROMPT: '1', ...envOverrides },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    signalState.child = child
    if (signalState.requested) {
      child.kill(signalState.count >= 2 ? 'SIGKILL' : signalState.requested)
    }
    afterSpawn?.()
    const captured = { stdout: [], stderr: [], stdoutBytes: 0, stderrBytes: 0 }
    const capture = (stream, key) => {
      stream.on('data', (value) => {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
        const byteKey = `${key}Bytes`
        const remaining = maxCapturedBytesPerStream - captured[byteKey]
        if (remaining <= 0) return
        captured[key].push(chunk.subarray(0, remaining))
        captured[byteKey] += Math.min(chunk.length, remaining)
      })
    }
    capture(child.stdout, 'stdout')
    capture(child.stderr, 'stderr')
    child.once('error', (error) => {
      signalState.child = null
      reject(error)
    })
    child.once('close', (code, signal) => {
      signalState.child = null
      resolve({
        code: signalState.requested ? 1 : (code ?? (signal ? 1 : 0)),
        signal: signal ?? signalState.requested,
        stdout: Buffer.concat(captured.stdout),
        stderr: Buffer.concat(captured.stderr)
      })
    })
  })

const run = async () => {
  const runner = await createRunnerRoot()
  let result
  try {
    if (signalState.requested && process.argv.includes('--internal-self-test-pre-root-signal')) {
      result = {
        code: 1,
        signal: signalState.requested,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0)
      }
      return result
    }
    const childFailureSelfTest = process.argv.includes('--self-test-child-failure')
    const privateOutputSelfTest = process.argv.includes('--self-test-private-child-failure')
    if (privateOutputSelfTest) {
      result = await runChild(process.execPath, [
        '-e',
        "process.stdout.write('SYNTHETIC_PRIVATE_PATH=/private/book/source.md\\n'); process.stderr.write('SYNTHETIC_PRIVATE_CONTENT=chapter-prose\\n'); process.exit(17)"
      ])
      if (
        !result.stdout.includes('SYNTHETIC_PRIVATE_PATH=') ||
        !result.stderr.includes('SYNTHETIC_PRIVATE_CONTENT=')
      ) {
        throw new Error('runner-private-output-self-test')
      }
    } else if (childFailureSelfTest) {
      result = await runChild(process.execPath, ['-e', 'process.exit(17)'])
    } else if (process.argv.includes('--self-test-signal-cleanup')) {
      result = await runChild(process.execPath, [
        fileURLToPath(import.meta.url),
        '--internal-self-test-signal-clean-exit'
      ])
      if (result.code !== 1 || !result.stdout.includes('RC_INTERNAL_SIGNAL_CLEANUP_PASS code=1')) {
        throw new Error('runner-signal-cleanup-self-test')
      }
    } else if (process.argv.includes('--self-test-pre-root-signal')) {
      result = await runChild(process.execPath, [
        fileURLToPath(import.meta.url),
        '--internal-self-test-pre-root-signal'
      ])
      if (
        result.code !== 1 ||
        !result.stdout.includes('RC_INTERNAL_PRE_ROOT_SIGNAL_CLEANUP_PASS code=1')
      ) {
        throw new Error('runner-pre-root-signal-self-test')
      }
    } else if (process.argv.includes('--internal-self-test-signal-clean-exit')) {
      result = await runChild(
        process.execPath,
        ['-e', "process.on('SIGTERM',()=>process.exit(19)); setInterval(()=>{},1000)"],
        {},
        () => setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100)
      )
    } else if (process.argv.includes('--self-test-direct-bypass')) {
      const sentinelRoot = path.join(runner.root, 'direct-bypass-source')
      await fs.mkdir(sentinelRoot)
      await fs.writeFile(path.join(sentinelRoot, 'sentinel.md'), 'PRIVATE_SENTINEL', {
        flag: 'wx',
        mode: 0o000
      })
      const sentinelStatBefore = await fs.stat(path.join(sentinelRoot, 'sentinel.md'))
      const bypassResult = await runChild(
        'pnpm',
        [
          'exec',
          'playwright',
          'test',
          '-c',
          'test/e2e/playwright.config.ts',
          'test/e2e/real-book-rc.spec.ts',
          '--reporter=line',
          `--output=${path.join(runner.root, 'bypass-artifacts')}`
        ],
        {
          LEAFBOOK_RC_BOOK_ROOT: sentinelRoot,
          LEAFBOOK_RC_RUNNER_ROOT: '',
          LEAFBOOK_RC_RUNNER_NONCE: '',
          PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: path.join(runner.root, 'bypass-last-run.json')
        }
      )
      const invalidResult = await runChild(
        'pnpm',
        [
          'exec',
          'playwright',
          'test',
          '-c',
          'test/e2e/playwright.config.ts',
          'test/e2e/real-book-rc.spec.ts',
          '--reporter=line',
          `--output=${path.join(runner.root, 'invalid-artifacts')}`
        ],
        {
          LEAFBOOK_RC_BOOK_ROOT: sentinelRoot,
          LEAFBOOK_RC_RUNNER_ROOT: runner.root,
          LEAFBOOK_RC_RUNNER_NONCE: '0'.repeat(64),
          PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: path.join(runner.root, 'invalid-last-run.json')
        }
      )
      result = { code: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
      const sentinelStatAfter = await fs.stat(path.join(sentinelRoot, 'sentinel.md'))
      const artifactFiles = await fs
        .readdir(path.join(runner.root, 'bypass-artifacts'), { recursive: true })
        .catch((error) => (error?.code === 'ENOENT' ? [] : Promise.reject(error)))
      if (
        bypassResult.code !== 0 ||
        !/\b1 skipped\b/.test(bypassResult.stdout.toString('utf8')) ||
        /\b[1-9]\d* passed\b/.test(bypassResult.stdout.toString('utf8')) ||
        invalidResult.code === 0 ||
        sentinelStatAfter.atimeMs !== sentinelStatBefore.atimeMs ||
        artifactFiles.length !== 0
      ) {
        throw new Error('runner-direct-bypass-self-test')
      }
    } else if (process.argv.includes('--self-test-broad-root')) {
      const broadResult = await runChild(
        'pnpm',
        [
          'exec',
          'playwright',
          'test',
          '-c',
          'test/e2e/playwright.config.ts',
          'test/e2e/real-book-rc.spec.ts',
          '--reporter=line',
          `--output=${path.join(runner.root, 'broad-root-artifacts')}`
        ],
        {
          LEAFBOOK_RC_BOOK_ROOT: path.parse(runner.root).root,
          LEAFBOOK_RC_RUNNER_ROOT: runner.root,
          LEAFBOOK_RC_RUNNER_NONCE: runner.marker.toString('hex'),
          PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: path.join(runner.root, 'broad-root-last-run.json')
        }
      )
      if (broadResult.code === 0) {
        throw new Error('runner-broad-root-self-test')
      }
      result = { code: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    } else {
      result = await runChild(
        'pnpm',
        [
          'exec',
          'playwright',
          'test',
          '-c',
          'test/e2e/playwright.config.ts',
          'test/e2e/real-book-rc.spec.ts',
          '--reporter=line',
          `--output=${path.join(runner.root, 'artifacts')}`
        ],
        {
          LEAFBOOK_RC_RUNNER_ROOT: runner.root,
          LEAFBOOK_RC_RUNNER_NONCE: runner.marker.toString('hex'),
          LEAFBOOK_RC_SYNTHETIC_PRIVATE: 'PRIVATE_ENV_SENTINEL',
          PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: path.join(runner.root, 'last-run.json')
        }
      )
      if (result.code === 0 && !result.stdout.includes('RC_AUTHORIZED_SPEC_PASS')) {
        result = { ...result, code: 1 }
      }
    }
    if ((childFailureSelfTest || privateOutputSelfTest) && result.code !== 17) {
      throw new Error('runner-child-failure-self-test')
    }
    // Captured child bytes are intentionally discarded in memory. Even the
    // marker-owned temporary root must never receive private failure output.
  } finally {
    await removeRunnerRoot(runner)
  }
  return result
}

const report = (result) => {
  if (signalState.requested) {
    result = { ...result, code: 1, signal: signalState.requested }
  }
  if (process.argv.includes('--self-test-private-child-failure')) {
    process.stdout.write('RC_RUNNER_PRIVATE_OUTPUT_CLEANUP_PASS\n')
    return
  }
  if (process.argv.includes('--self-test-child-failure')) {
    process.stdout.write('RC_RUNNER_CHILD_FAILURE_CLEANUP_PASS\n')
    return
  }
  if (process.argv.includes('--self-test-direct-bypass')) {
    process.stdout.write('RC_RUNNER_DIRECT_BYPASS_PASS\n')
    return
  }
  if (process.argv.includes('--self-test-broad-root')) {
    process.stdout.write('RC_RUNNER_BROAD_ROOT_REJECTION_PASS\n')
    return
  }
  if (process.argv.includes('--self-test-signal-cleanup')) {
    process.stdout.write('RC_RUNNER_SIGNAL_CLEANUP_PASS code=0\n')
    return
  }
  if (process.argv.includes('--self-test-pre-root-signal')) {
    process.stdout.write('RC_RUNNER_PRE_ROOT_SIGNAL_CLEANUP_PASS code=0\n')
    return
  }
  if (process.argv.includes('--internal-self-test-signal-clean-exit')) {
    process.stdout.write('RC_INTERNAL_SIGNAL_CLEANUP_PASS code=1\n')
    process.exitCode = 1
    return
  }
  const acceptedBoundaries =
    'accepted_p3_boundaries=crash_partial_create,same_user_syscall_path_boundary,unicode_casefold_pin_drift'
  const releaseTruth = `product_ready=false visual_fidelity=false content_adaptation_gaps=1 release_matrix_ready=false ${acceptedBoundaries}`
  process.stdout.write(
    result.code === 0
      ? `RC_HARNESS_PASS ${releaseTruth} book_structure_ready=true code=0\n`
      : `RC_HARNESS_FAIL ${releaseTruth} book_structure_ready=false code=${result.code}\n`
  )
  process.exitCode = result.code
}

if (process.argv.includes('--internal-self-test-pre-root-signal')) {
  process.kill(process.pid, 'SIGTERM')
}
const isSelfTest = process.argv.some(
  (value) => value.startsWith('--self-test-') || value.startsWith('--internal-self-test-')
)
const execution =
  !isSelfTest && !process.env.LEAFBOOK_RC_BOOK_ROOT ? Promise.resolve({ skipped: true }) : run()
execution
  .then((result) => {
    releaseSignalHandlers()
    if (result.skipped) {
      process.stdout.write(
        'RC_HARNESS_SKIP product_ready=false visual_fidelity=false content_adaptation_gaps=1 release_matrix_ready=false accepted_p3_boundaries=crash_partial_create,same_user_syscall_path_boundary,unicode_casefold_pin_drift book_structure_ready=false code=0\n'
      )
      return
    }
    if (process.argv.includes('--internal-self-test-pre-root-signal')) {
      process.stdout.write('RC_INTERNAL_PRE_ROOT_SIGNAL_CLEANUP_PASS code=1\n')
      process.exitCode = 1
      return
    }
    report(result)
  })
  .catch(() => {
    releaseSignalHandlers()
    process.stderr.write(
      'RC_HARNESS_FAIL product_ready=false visual_fidelity=false content_adaptation_gaps=1 release_matrix_ready=false accepted_p3_boundaries=crash_partial_create,same_user_syscall_path_boundary,unicode_casefold_pin_drift book_structure_ready=false code=1\n'
    )
    process.exitCode = 1
  })
