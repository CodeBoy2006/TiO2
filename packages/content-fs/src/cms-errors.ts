export type CmsRepositoryErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT'

export class CmsRepositoryError extends Error {
    readonly code: CmsRepositoryErrorCode

    constructor(code: CmsRepositoryErrorCode, message: string) {
        super(message)
        this.name = 'CmsRepositoryError'
        this.code = code
    }
}
