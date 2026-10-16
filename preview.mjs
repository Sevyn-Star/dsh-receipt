import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const port = Number(process.env.PORT || 4173)
const card = readFileSync(new URL('./src/card.js', import.meta.url), 'utf8')
const page = `<!doctype html>
<meta charset="utf-8">
<title>收据</title>
<style>
  body { margin: 0; min-height: 100vh; background: #f3f3f1; color: #222; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 36rem; padding: 48px 24px; }
</style>
<main>
  <p>左下角那张卡片就是收据。数字每两秒跳一次，点开能看到三行。</p>
</main>
<script src="/dsh-receipt/card.js"></script>
`

const steps = [0, 150_000, 300_000, 450_000]
const started = Date.now()

function receipt() {
  const index = Math.min(steps.length - 1, Math.floor((Date.now() - started) / 2000))
  const waste = steps[index]
  return {
    latestStepMicro: index === 0 ? 0 : 150_000,
    sessionMicro: waste === 0 ? 0 : waste + 150_000,
    wasteMicro: waste,
    wasteCount: index,
    unpricedSteps: 0,
    currency: 'USD',
    period: 'off-peak',
    priceCheckedOn: '2026-10-15',
  }
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  if (path === '/dsh-receipt/card.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
    res.end(card)
    return
  }
  if (path === '/dsh-receipt/latest') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(receipt()))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(page)
}).listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}`)
})
