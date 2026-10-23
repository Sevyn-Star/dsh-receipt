// 金额格式与 src/ledger.ts 的 formatUsd 一致：1 单位 = 10^-6 美元。
var rootId = 'dsh-receipt'

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatText(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>')
}

function formatUsd(micro) {
  var sign = micro < 0 ? '-' : ''
  var absolute = Math.abs(Math.round(micro))
  var dollars = Math.floor(absolute / 1000000)
  var fraction = String(absolute % 1000000).padStart(6, '0').replace(/0+$/, '')
  return fraction ? sign + '$' + dollars + '.' + fraction : sign + '$' + dollars
}

function mount() {
  if (document.getElementById(rootId)) return
  var style = document.createElement('style')
  style.textContent = [
    '#dsh-receipt{position:fixed;left:16px;bottom:16px;z-index:80;display:flex;flex-direction:column-reverse;align-items:flex-start;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",ui-sans-serif,system-ui,sans-serif;color:#f4f4f5;-webkit-font-smoothing:antialiased}',
    '#dsh-receipt button,#dsh-receipt .detail{display:block;box-sizing:border-box;border:1px solid rgba(255,255,255,.1);background:rgba(22,22,25,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:inherit;border-radius:14px;box-shadow:0 12px 32px -4px rgba(0,0,0,.38),0 2px 6px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.06)}',
    '#dsh-receipt button{min-width:132px;padding:10px 14px 11px;cursor:pointer;text-align:left;transition:transform .16s ease,border-color .16s ease,background-color .16s ease,box-shadow .16s ease}',
    '#dsh-receipt button:hover{border-color:rgba(255,255,255,.2);background:rgba(28,28,32,.95);transform:translateY(-1px)}',
    '#dsh-receipt button:active{transform:translateY(0)}',
    '#dsh-receipt button[aria-expanded="true"]{border-color:rgba(255,255,255,.22)}',
    '#dsh-receipt .kicker{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;font-weight:500;letter-spacing:.02em;color:#a1a1aa;margin-bottom:2px}',
    '#dsh-receipt .kicker::after{content:"";width:6px;height:6px;border-radius:999px;background:#52525b;box-shadow:0 0 0 2px rgba(82,82,91,.2);transition:background-color .2s ease,box-shadow .2s ease}',
    '#dsh-receipt[data-waste="true"] .kicker::after{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.22)}',
    '#dsh-receipt strong{display:block;font-size:23px;font-weight:650;line-height:1.18;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:#fafafa}',
    '#dsh-receipt[data-waste="true"] strong{color:#fbbf24}',
    '#dsh-receipt .detail{margin-bottom:8px;padding:12px 14px;min-width:236px;max-width:360px;animation:dsh-receipt-in .16s cubic-bezier(.16,1,.3,1)}',
    '#dsh-receipt .detail[hidden]{display:none}',
    '@keyframes dsh-receipt-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '#dsh-receipt .detail p{margin:0;overflow-wrap:anywhere}',
    '#dsh-receipt .detail .row{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:3px 0;color:#d4d4d8}',
    '#dsh-receipt .detail .row .label{color:#a1a1aa}',
    '#dsh-receipt .detail .row .val{font-variant-numeric:tabular-nums;font-weight:500;color:#f4f4f5}',
    '#dsh-receipt .detail .row-waste{margin-top:2px;padding-top:6px;border-top:1px dashed rgba(255,255,255,.1)}',
    '#dsh-receipt .detail .row-waste .label{color:#e4e4e7;font-weight:500}',
    '#dsh-receipt .detail .row-waste .val{color:#fbbf24;font-weight:600}',
    '#dsh-receipt .repeats{margin:10px 0 4px;padding-top:9px;border-top:1px dashed rgba(255,255,255,.12);font-size:11px;font-weight:600;letter-spacing:.03em;color:#a1a1aa}',
    '#dsh-receipt .repeat-item{padding:3px 0;font-size:12px;line-height:1.5;color:#e4e4e7}',
    '#dsh-receipt .repeat-item code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11.5px;padding:1px 5px;margin:0 1px;border-radius:4px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.07);color:#f4f4f5}',
    '#dsh-receipt .repeat-item .repeat-money{color:#fbbf24;font-variant-numeric:tabular-nums}',
    '#dsh-receipt .note{margin:9px 0 0;padding-top:7px;border-top:1px solid rgba(255,255,255,.07);font-size:11px;color:#71717a;display:flex;align-items:center;justify-content:space-between}',
  ].join('')
  document.head.appendChild(style)

  var root = document.createElement('aside')
  root.id = rootId
  var button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-expanded', 'false')
  button.innerHTML = '<span class="kicker">白烧了</span><strong>$0</strong>'
  var detail = document.createElement('div')
  detail.className = 'detail'
  detail.hidden = true
  root.appendChild(button)
  root.appendChild(detail)
  document.body.appendChild(root)

  var shown = 0
  var frame = 0
  button.addEventListener('click', function () {
    detail.hidden = !detail.hidden
    button.setAttribute('aria-expanded', detail.hidden ? 'false' : 'true')
  })

  function paint(micro) {
    var node = button.querySelector('strong')
    if (node) node.textContent = formatUsd(micro)
  }

  function roll(next) {
    cancelAnimationFrame(frame)
    var from = shown
    var started = performance.now()
    function step(now) {
      var t = Math.min(1, (now - started) / 400)
      shown = Math.round(from + (next - from) * t)
      paint(shown)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  function currentSessionId() {
    try {
      var raw = localStorage.getItem('dsh.sessions.current')
      if (!raw) return ''
      var parsed = JSON.parse(raw)
      return typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
    } catch (error) {
      return ''
    }
  }

  function refresh() {
    var sessionId = currentSessionId()
    var path = sessionId ? '/dsh-receipt/latest?session=' + encodeURIComponent(sessionId) : '/dsh-receipt/latest'
    fetch(path, { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null })
      .then(function (receipt) {
        if (!receipt) return
        root.setAttribute('data-waste', receipt.wasteMicro > 0 ? 'true' : 'false')
        if (receipt.unpricedSteps > 0 && receipt.sessionMicro === 0 && receipt.wasteMicro === 0) {
          cancelAnimationFrame(frame)
          shown = 0
          var unknown = button.querySelector('strong')
          if (unknown) unknown.textContent = '未定价'
        } else if (receipt.wasteMicro !== shown) roll(receipt.wasteMicro)
        var step = receipt.latestStepMicro == null ? '—' : formatUsd(receipt.latestStepMicro)
        var html = '<p class="row"><span class="label">这一步 </span><span class="val">' + step + '</span></p>'
          + '<p class="row"><span class="label">这场会话 </span><span class="val">' + formatUsd(receipt.sessionMicro) + '</span></p>'
          + '<p class="row row-waste"><span class="label">盲重试浪费了 </span><span class="val">' + formatUsd(receipt.wasteMicro) + '</span></p>'
        var repeats = receipt.repeats
        if (repeats && repeats.length) {
          html += '<p class="repeats">这场在重复什么</p>'
          for (var i = 0; i < repeats.length; i++) {
            var row = repeats[i]
            var money = row.micro == null ? '' : '，大约 <span class="repeat-money">' + formatUsd(row.micro) + '</span>'
            html += '<p class="repeat-item">' + formatText(row.text) + money + '</p>'
          }
        }
        detail.innerHTML = html + '<p class="note"><span>按本地价目估算</span></p>'
      })
      .catch(function () {})
  }

  refresh()
  setInterval(refresh, 1000)
}

if (document.body) mount()
else document.addEventListener('DOMContentLoaded', mount)
