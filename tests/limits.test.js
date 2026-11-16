import assert from 'node:assert/strict'
import test from 'node:test'
import { clientIp, DailyQuota } from '../server/limits.js'

test('clientIp strips the port App Service adds and IPv4-mapped prefixes', () => {
  assert.equal(clientIp({ ip: '203.0.113.7:51234' }), '203.0.113.7')
  assert.equal(clientIp({ ip: '203.0.113.7' }), '203.0.113.7')
  assert.equal(clientIp({ ip: '[2001:db8::1]:443' }), '2001:db8::1')
  assert.equal(clientIp({ ip: '::ffff:127.0.0.1' }), '127.0.0.1')
})

test('DailyQuota counts per key, refunds, and sweeps previous days', () => {
  let now = Date.parse('2026-11-15T10:00:00Z')
  const q = new DailyQuota({ limit: 2, now: () => now })
  q.take('a')
  q.take('a')
  assert.equal(q.remaining('a'), 0)
  assert.equal(q.remaining('b'), 2)
  q.refund('a')
  assert.equal(q.remaining('a'), 1)
  now = Date.parse('2026-11-16T00:00:01Z')
  q.sweep()
  assert.equal(q.counts.size, 0)
  assert.equal(q.remaining('a'), 2)
})
