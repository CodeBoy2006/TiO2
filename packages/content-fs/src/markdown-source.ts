import fs from 'fs-extra'
import matter from 'gray-matter'

function parseMarkdownSource(rawContent: string) {
    const { data, content } = matter(rawContent)
    return { rawContent, data, content }
}

export type MarkdownSource = ReturnType<typeof parseMarkdownSource>

export async function readMarkdownSource(sourcePath: string) {
    return parseMarkdownSource(await fs.readFile(sourcePath, 'utf8'))
}
