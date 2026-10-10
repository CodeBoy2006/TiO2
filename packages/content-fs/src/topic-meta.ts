import { convertOrder } from '../../content-core/src/collection-utils'
import { normalizeMetaDescription } from '../../content-core/src/topic-tree'
import { readMarkdownSource } from './markdown-source'

export interface ParsedTopicMeta {
    title: string
    description: string
    order: number
}

export async function parseTopicMetaFile(metaPath: string): Promise<ParsedTopicMeta> {
    const { data, content: body } = await readMarkdownSource(metaPath)

    return {
        title: typeof data.title === 'string' ? data.title.trim() : '',
        description:
            typeof data.description === 'string' && data.description.trim()
                ? data.description.trim()
                : normalizeMetaDescription(body),
        order: convertOrder(data.order)
    }
}
