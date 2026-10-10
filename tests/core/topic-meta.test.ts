import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import fs from 'fs-extra'
import { parseTopicMetaFile } from '../../packages/content-fs/src/index.js'

test('TiO2 topic meta parser respects explicit frontmatter fields', async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), 'tio2-topic-meta-'))
    const metaPath = join(tempDir, '_meta.md')

    try {
        await fs.writeFile(
            metaPath,
            ['---', 'title: " TiO2 专题 "', 'description: " 手写描述 "', 'order: "7"', '---', 'Body is ignored.'].join(
                '\n'
            )
        )

        assert.deepEqual(await parseTopicMetaFile(metaPath), {
            title: 'TiO2 专题',
            description: '手写描述',
            order: 7
        })
    } finally {
        await fs.remove(tempDir)
    }
})

test('TiO2 topic meta parser falls back to cleaned markdown descriptions', async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), 'tio2-topic-meta-fallback-'))
    const metaPath = join(tempDir, '_meta.md')

    try {
        await fs.writeFile(
            metaPath,
            ['---', 'title: 框架化', 'order: bad-value', '---', `**TiO2** <b>framework</b> ${'notes '.repeat(40)}`].join(
                '\n'
            )
        )

        const parsed = await parseTopicMetaFile(metaPath)
        assert.equal(parsed.title, '框架化')
        assert.equal(parsed.order, 0)
        assert.match(parsed.description, /^TiO2 framework notes /)
        assert.ok(parsed.description.endsWith('…'))
        assert.ok(parsed.description.length <= 180)
    } finally {
        await fs.remove(tempDir)
    }
})
