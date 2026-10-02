import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('branded loading screen reports genuine initialization status without fake progress', () => {
  const source = readFileSync('src/components/feedback/LoadingScreen.tsx', 'utf8')
  const guards = readFileSync('src/components/routing/RouteGuards.tsx', 'utf8')
  assert.match(source, /SmallBizz/)
  assert.match(source, /Preparing your workspace/)
  assert.match(source, /aria-busy="true"/)
  assert.doesNotMatch(source, /\d+%/)
  assert.doesNotMatch(source, /setTimeout|setInterval|new Promise/)
  assert.ok((guards.match(/if \(loading\) return <LoadingScreen \/>/g) ?? []).length >= 4)
  assert.match(guards, /if \(!user\) return/)
})

test('loading and dashboard transitions provide an explicit reduced-motion path', () => {
  const styles = readFileSync('src/styles/index.css', 'utf8')
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(styles, /\.app-loader__indicator span/)
  assert.match(styles, /animation: none !important/)
  assert.match(styles, /\.dashboard-rise/)
})
