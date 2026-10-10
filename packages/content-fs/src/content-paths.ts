import type { TiO2ContentConfig } from '../../config/src/types.js'

function scopePattern(rootDir: string, pattern: string) {
    const normalizedRootDir = rootDir.replace(/\/+$/g, '')
    const normalizedPattern = pattern.replace(/^\.\//, '')

    if (normalizedPattern.startsWith(`${normalizedRootDir}/`)) {
        return normalizedPattern
    }

    return `${normalizedRootDir}/${normalizedPattern}`
}

function getMarkdownSourcePatterns(rootDir: string) {
    return [`${rootDir}/**/*.md`]
}

function getProductionIgnorePatterns(contentConfig: TiO2ContentConfig, rootDir: string, production: boolean) {
    if (!production) return []
    return contentConfig.productionIgnorePatterns.map((pattern) => scopePattern(rootDir, pattern))
}

export function getPostSourcePatterns(contentConfig: TiO2ContentConfig) {
    return getMarkdownSourcePatterns(contentConfig.postsDir)
}

export function getPostIgnorePatterns(contentConfig: TiO2ContentConfig, { production = false } = {}) {
    return getProductionIgnorePatterns(contentConfig, contentConfig.postsDir, production)
}

export function getTopicArticleSourcePatterns(contentConfig: TiO2ContentConfig) {
    return getMarkdownSourcePatterns(contentConfig.topicsDir)
}

export function getTopicArticleIgnorePatterns(contentConfig: TiO2ContentConfig, { production = false } = {}) {
    const ignorePatterns = getTopicMetaSourcePatterns(contentConfig)
    return [...getProductionIgnorePatterns(contentConfig, contentConfig.topicsDir, production), ...ignorePatterns]
}

export function getTopicMetaSourcePatterns(contentConfig: TiO2ContentConfig) {
    return [`${contentConfig.topicsDir}/**/${contentConfig.topicMetaFilename}`]
}

export function getTopicMetaIgnorePatterns(contentConfig: TiO2ContentConfig, { production = false } = {}) {
    return getProductionIgnorePatterns(contentConfig, contentConfig.topicsDir, production)
}

export function getFoundationSourcePatterns(contentConfig: TiO2ContentConfig) {
    return getMarkdownSourcePatterns(contentConfig.foundationsDir)
}

export function getFoundationIgnorePatterns(contentConfig: TiO2ContentConfig, { production = false } = {}) {
    return getProductionIgnorePatterns(contentConfig, contentConfig.foundationsDir, production)
}

export function getPageSourcePatterns(contentConfig: TiO2ContentConfig) {
    return getMarkdownSourcePatterns(contentConfig.pagesDir)
}

export function getPageIgnorePatterns(contentConfig: TiO2ContentConfig, { production = false } = {}) {
    return getProductionIgnorePatterns(contentConfig, contentConfig.pagesDir, production)
}
