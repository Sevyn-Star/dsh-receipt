// 金额格式与 src/ledger.ts 的 formatUsd 一致：1 单位 = 10^-6 美元。
var rootId = 'dsh-receipt'

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
    '#dsh-receipt{position:fixed;left:16px;bottom:16px;z-index:80;display:flex;flex-direction:column-reverse;align-items:flex-start;font:13px/1.4 ui-sans-serif,system-ui,sans-serif;color:#f4f4f5}',
    '#dsh-receipt button,#dsh-receipt .detail{display:block;border:0;background:rgba(20,20,20,.92);color:inherit;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.28)}',
    '#dsh-receipt button{padding:10px 12px;cursor:pointer;text-align:left}',
    '#dsh-receipt .kicker{display:block;opacity:.72}',
    '#dsh-receipt strong{display:block;font-size:22px;font-variant-numeric:tabular-nums}',
    '#dsh-receipt .detail{margin-bottom:8px;padding:10px 12px;max-width:360px}',
    '#dsh-receipt .detail[hidden]{display:none}',
    '#dsh-receipt .detail p{margin:4px 0;overflow-wrap:anywhere}',
    '#dsh-receipt .repeats{margin:10px 0 2px;opacity:.72}',
    '#dsh-receipt .note{margin:8px 0 0;opacity:.6}',
  ].join('')
  document.head.appendChild(style)

  var root = document.createElement('aside')
  root.id = rootId
  var button = document.createElement('button')
  button.type = 'button'
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
        if (receipt.unpricedSteps > 0 && receipt.sessionMicro === 0 && receipt.wasteMicro === 0) {
          cancelAnimationFrame(frame)
          shown = 0
          var unknown = button.querySelector('strong')
          if (unknown) unknown.textContent = '未定价'
        } else if (receipt.wasteMicro !== shown) roll(receipt.wasteMicro)
        var step = receipt.latestStepMicro == null ? '—' : formatUsd(receipt.latestStepMicro)
        var html = '<p>这一步 ' + step + '</p>'
          + '<p>这场会话 ' + formatUsd(receipt.sessionMicro) + '</p>'
          + '<p>盲重试浪费了 ' + formatUsd(receipt.wasteMicro) + '</p>'
        var repeats = receipt.repeats
        if (repeats && repeats.length) {
          html += '<p class="repeats">这场在重复什么</p>'
          for (var i = 0; i < repeats.length; i++) {
            var row = repeats[i]
            var money = row.micro == null ? '' : '，大约 ' + formatUsd(row.micro)
            html += '<p>' + escapeHtml(row.text) + money + '</p>'
          }
        }
        detail.innerHTML = html + '<p class="note">按本地价目估算</p>'
      })
      .catch(function () {})
  }

  refresh()
  setInterval(refresh, 1000)
}

if (document.body) mount()
else document.addEventListener('DOMContentLoaded', mount)
