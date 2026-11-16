import { AzureCliCredential, DefaultAzureCredential } from '@azure/identity'
import { config } from './config.js'

const credential =
  config.authMode === 'default'
    ? new DefaultAzureCredential(config.tenantId ? { tenantId: config.tenantId } : undefined)
    : new AzureCliCredential(config.tenantId ? { tenantId: config.tenantId } : undefined)

// AzureCliCredential shells out to `az` on every call, so cache the token
// in memory (server-side only) until shortly before it expires.
const REFRESH_MARGIN_MS = 5 * 60 * 1000
let cached = null
let inflight = null

export async function getAccessToken() {
  if (cached && cached.expiresOnTimestamp - REFRESH_MARGIN_MS > Date.now()) {
    return cached.token
  }
  if (!inflight) {
    inflight = credential
      .getToken(config.tokenScope)
      .then((token) => {
        if (!token?.token) throw new Error('Azure credential returned an empty token.')
        cached = token
        return token.token
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function clearCachedToken() {
  cached = null
}
