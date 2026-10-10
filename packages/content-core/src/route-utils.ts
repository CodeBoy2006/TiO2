export function encodeRoutePathSegments(sourcePath: string) {
    return sourcePath
        .replace(/\\/gu, '/')
        .replace(/^\/+/u, '')
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/')
}

export function createMarkdownRoute(sourcePath: string) {
    const htmlPath = sourcePath.replace(/\.md$/u, '.html')
    const encodedPath = encodeRoutePathSegments(htmlPath)
    return encodedPath ? `/${encodedPath}` : '/'
}
