// Runs the API bridge and the Vite dev server together (no extra dependencies).
import { spawn, spawnSync } from 'node:child_process'

const procs = [
  { name: 'api', color: '\x1b[35m', script: 'dev:api' },
  { name: 'web', color: '\x1b[36m', script: 'dev' },
].map(({ name, color, script }) => {
  // A single fixed command string (no user input) works with npm.cmd on Windows and npm elsewhere.
  const child = spawn(`npm run ${script}`, { stdio: ['inherit', 'pipe', 'pipe'], shell: true })
  const prefix = `${color}[${name}]\x1b[0m `
  const pipe = (stream, out) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line) out.write(prefix + line + '\n')
    })
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`)
    shutdown(code ?? 0)
  })
  return child
})

let shuttingDown = false
function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const p of procs) {
    if (p.exitCode !== null || !p.pid) continue
    // On Windows, kill the whole tree (shell -> npm -> node) so no server is left behind.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
    else p.kill()
  }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
