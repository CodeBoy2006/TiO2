import assert from 'node:assert/strict'
import test from 'node:test'
import {
    forgetEncryptedSessionPassphrase,
    readEncryptedSessionPassphrase,
    rememberEncryptedSessionPassphrase
} from '../../site/client/encrypted-session.js'

test('TiO2 encrypted sessions retain passphrases only in explicit in-memory slots', () => {
    const cacheKey = 'fixture-cache-key'

    forgetEncryptedSessionPassphrase(cacheKey)
    assert.equal(readEncryptedSessionPassphrase(cacheKey), '')

    rememberEncryptedSessionPassphrase(cacheKey, ' passphrase with spaces ')
    assert.equal(readEncryptedSessionPassphrase(cacheKey), ' passphrase with spaces ')

    forgetEncryptedSessionPassphrase(cacheKey)
    assert.equal(readEncryptedSessionPassphrase(cacheKey), '')
    assert.equal(readEncryptedSessionPassphrase(''), '')
})
