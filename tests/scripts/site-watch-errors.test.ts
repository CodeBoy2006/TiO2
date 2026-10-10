import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const runtime = await import(pathToFileURL(path.resolve('scripts/run-site.mjs')).href)
const root = path.resolve('watch-consumer')
const temporary = path.join(root, '.tio2-tmp')
const scanError = (file: unknown, code = 'ENOENT', syscall = 'scandir') => ({ code, syscall, path: file })

test('missing generated directories are the only transient watcher scan errors', () => {
    for (const file of [temporary, path.join(temporary, 'site-work'), path.join(temporary, 'site-work', 'images')]) {
        assert.equal(runtime.isTransientBuildWatchError(scanError(file), root), true, file)
    }
})

test('watcher path containment rejects lookalike prefixes, other consumers and traversal', () => {
    for (const file of [
        root,
        path.join(root, 'writing', 'missing'),
        `${temporary}-other/site-work`,
        path.join(`${root}-other`, '.tio2-tmp', 'site-work'),
        path.join(temporary, '..', 'writing', 'missing'),
        path.join(temporary, '..', '..', '.tio2-tmp', 'missing')
    ]) {
        assert.equal(runtime.isTransientBuildWatchError(scanError(file), root), false, file)
    }
})

test('permission errors and other syscalls remain fatal even inside generated output', () => {
    for (const error of [
        scanError(temporary, 'EACCES'),
        scanError(temporary, 'ENOSPC'),
        scanError(temporary, 'ENOENT', 'open'),
        scanError(temporary, 'ENOENT', 'watch')
    ]) {
        assert.equal(runtime.isTransientBuildWatchError(error, root), false)
    }
})

test('a watcher error without an absolute string path cannot be classified as generated output', () => {
    for (const file of [undefined, null, Buffer.from(temporary), '.tio2-tmp/site-work']) {
        assert.equal(runtime.isTransientBuildWatchError(scanError(file), root), false)
    }
})
