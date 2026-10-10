export interface BlogPostingJsonLdInput {
    title: string
    description: string
    url: string
    image: string
    language: string
    author: string
    authorUrl: string
    publishedAt?: string
    modifiedAt?: string
    section?: string
    tags?: string[]
    wordCount?: number
}

export function createBlogPostingJsonLd(input: BlogPostingJsonLdInput) {
    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: input.title,
        description: input.description,
        url: input.url,
        mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': input.url
        },
        image: input.image || undefined,
        inLanguage: input.language,
        datePublished: input.publishedAt || undefined,
        dateModified: input.modifiedAt || input.publishedAt || undefined,
        articleSection: input.section || undefined,
        keywords: input.tags?.length ? input.tags.join(', ') : undefined,
        wordCount: input.wordCount || undefined,
        author: {
            '@type': 'Person',
            name: input.author,
            url: input.authorUrl
        },
        publisher: {
            '@type': 'Person',
            name: input.author,
            url: input.authorUrl
        }
    }

    return JSON.stringify(jsonLd)
        .replace(/</gu, '\\u003c')
        .replace(/\u2028/gu, '\\u2028')
        .replace(/\u2029/gu, '\\u2029')
}
