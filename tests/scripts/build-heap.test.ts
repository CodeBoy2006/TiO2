import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFile = promisify(execFileCallback)
const runtime = pathToFileURL(path.resolve('scripts/run-site.mjs')).href
let fixture: string
const phases = [
    'site/build-client.mts',
    'site/build-site.mts',
    'scripts/build-search-index.ts',
    'scripts/write-site-artifacts.ts'
]

before(async () => {
    fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tio2-build-heap-')))
    await fs.writeFile(
        path.join(fixture, 'tio2.config.mjs'),
        'export default { site: { title: "Heap test", url: "https://heap.test" } }'
    )
})
after(async () => {
    if (fixture) await fs.rm(fixture, { recursive: true, force: true })
})

// Isolate builtin mocks in a subprocess, without running builds or opening a server.
const probe = `
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'

const spawns = []
const errors = []
const logs = []
let watches = 0
console.error = (...args) => errors.push(args.join(' '))
console.log = (...args) => logs.push(args.join(' '))
fs.watch = () => {
    watches += 1
    return Object.assign(new EventEmitter(), { close() {} })
}
childProcess.spawn = (executable, args, options) => {
    spawns.push({ executable, args, cwd: options.cwd, mode: options.env.NODE_ENV })
    const child = Object.assign(new EventEmitter(), { kill() { return true } })
    // Stop dev after its final phase, before it replaces output or opens a server.
    const code = options.env.NODE_ENV === 'development' && args.at(-1).endsWith('write-site-artifacts.ts') ? 1 : 0
    setImmediate(() => child.emit('exit', code, null))
    return child
}
syncBuiltinESMExports()
try {
    await (await import(${JSON.stringify(runtime)}))[process.env.TIO2_TEST_BUILD_COMMAND]()
} catch (error) {
    errors.push(error.message)
}
process.stdout.write(JSON.stringify({ spawns, errors, logs, watches }))
`

async function inspect(command: 'build' | 'dev', heap?: string) {
    const env: NodeJS.ProcessEnv = { ...process.env, TIO2_PROJECT_ROOT: fixture, TIO2_TEST_BUILD_COMMAND: command }
    delete env.TIO2_BUILD_HEAP_MB
    if (heap !== undefined) env.TIO2_BUILD_HEAP_MB = heap
    const { stdout } = await execFile(process.execPath, ['--input-type=module', '--eval', probe], {
        env,
        timeout: 10_000
    })
    return JSON.parse(stdout) as {
        spawns: { executable: string; args: string[]; cwd: string; mode: string }[]
        errors: string[]
        logs: string[]
        watches: number
    }
}

for (const command of ['build', 'dev'] as const) {
    for (const [label, value, expected] of [
        ['default', undefined, 4096],
        ['explicit override', '8192', 8192],
        ['minimum', '128', 128],
        ['maximum', '65536', 65536]
    ] as const) {
        test(`${command} uses the ${label} heap for every phase`, async () => {
            const result = await inspect(command, value)
            const entries =
                command === 'build'
                    ? [...phases, 'scripts/verify-eleventy-site.ts', 'scripts/verify-site-client.ts']
                    : phases
            assert.equal(result.spawns.length, entries.length, result.errors.join('\n'))
            const completed = command === 'build' ? entries : entries.slice(0, -1)
            assert.equal(result.logs.length, completed.length)
            for (const [index, entry] of completed.entries()) {
                assert.ok(result.logs[index].startsWith(`[tio2:build] ${entry}: `))
            }
            for (const [index, child] of result.spawns.entries()) {
                assert.equal(child.executable, process.execPath)
                assert.deepEqual(child.args, [
                    `--max-old-space-size=${expected}`,
                    '--import',
                    path.resolve('scripts/register-ts.mjs'),
                    path.resolve(entries[index])
                ])
                assert.equal(child.cwd, fixture)
                assert.equal(child.mode, command === 'build' ? 'production' : 'development')
            }
            assert.deepEqual(
                result.errors,
                command === 'build' ? [] : ['[tio2:dev] scripts/write-site-artifacts.ts exited with 1']
            )
        })
    }

    test(`${command} rejects invalid heaps before spawning or watching`, async () => {
        for (const value of [
            '',
            ' ',
            'invalid',
            'NaN',
            'Infinity',
            '-Infinity',
            '0',
            '-1',
            '127',
            '65537',
            '4096.5',
            '9007199254740992'
        ]) {
            const result = await inspect(command, value)
            assert.deepEqual(result.spawns, [], value)
            assert.equal(result.watches, 0, value)
            assert.deepEqual(
                result.errors,
                ['Invalid TIO2_BUILD_HEAP_MB: expected an integer from 128 to 65536 MiB'],
                value
            )
        }
    })
}
