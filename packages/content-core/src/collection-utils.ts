import type { BlogPost } from './types'

export function assignNavigation(collection: BlogPost[]) {
    collection.forEach((article, index) => {
        article.previousSourcePath = collection[index - 1]?.sourcePath
        article.nextSourcePath = collection[index + 1]?.sourcePath
    })
}

export function compareArticleDate(
    obj1: { frontMatter: { publishedAt: string; order: number } },
    obj2: { frontMatter: { publishedAt: string; order: number } }
) {
    const orderCompare = obj2.frontMatter.order - obj1.frontMatter.order
    if (orderCompare !== 0) return orderCompare
    return obj1.frontMatter.publishedAt < obj2.frontMatter.publishedAt ? 1 : -1
}

export function convertOrder(input?: unknown): number {
    if (input === undefined || input === null) return 0
    if (typeof input === 'number') return input
    const num = Number(input)
    return isNaN(num) ? 0 : num
}
