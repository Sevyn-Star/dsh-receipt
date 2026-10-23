import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const port = Number(process.env.PORT || 4173)
const card = readFileSync(new URL('./src/card.js', import.meta.url), 'utf8')
const page = `<!doctype html>
<meta charset="utf-8">
<title>收据 · 预览</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: radial-gradient(circle at 50% 0%, #ffffff 0%, #f4f4f2 70%);
    color: #18181b;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 40rem;
    margin: 0 auto;
    padding: 64px 24px;
  }
  .badge {
    display: inline-block;
    font-size: 12px;
    font-weight: 500;
    color: #52525b;
    background: #e4e4e7;
    padding: 3px 10px;
    border-radius: 999px;
    margin-bottom: 12px;
  }
  h1 {
    margin: 0 0 12px;
    font-size: 24px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  p {
    margin: 0;
    color: #52525b;
  }
</style>
<main>
  <span class="badge">dsh-receipt</span>
  <h1>收据卡片预览</h1>
  <p>左下角那张卡片就是收据。数字每两秒跳一次，点开能看到三行明细与重复调用。</p>
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
    repeats: index === 0 ? [] : [
      {
        text: `读 \`/tmp/dsh-receipt-missing.txt\`，失败后又读了 ${index} 次`,
        count: index,
        micro: waste,
      },
    ],
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
