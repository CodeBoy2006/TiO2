import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { rename } from 'node:fs/promises'
import fs from 'fs-extra'

export function createSiblingTemporaryPath(targetPath: string, purpose: string) {
    return join(dirname(targetPath), `.${basename(targetPath)}.${purpose}-${process.pid}-${randomUUID()}.tmp`)
}

export async function writeTextFileAtomically(targetPath: string, content: string) {
    const temporaryPath = createSiblingTemporaryPath(targetPath, 'write')

    await fs.ensureDir(dirname(targetPath))

    try {
        await fs.writeFile(temporaryPath, content, 'utf8')
        await rename(temporaryPath, targetPath)
    } finally {
        await fs.remove(temporaryPath)
    }
}
