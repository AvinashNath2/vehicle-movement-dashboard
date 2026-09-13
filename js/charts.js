/* Small dependency-free SVG bar chart for the "Daily KM Movement" widget.
   Single series (magnitude) → one hue, per the data-viz sequential rule. */

function niceMax(v){
  if (v <= 0) return 100;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  let step;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 5) step = 5;
  else step = 10;
  return step * mag;
}

function renderDailyKmChart(container, series){
  // series: [{ dateISO, label, value }]
  const W = 640, H = 260;
  const padL = 46, padR = 12, padT = 14, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = niceMax(Math.max(...series.map(s => s.value), 1));
  const ticks = 4;
  const barGap = 18;
  const barW = Math.min(46, (plotW / series.length) - barGap);

  let gridSvg = '';
  let axisLabels = '';
  for (let i = 0; i <= ticks; i++){
    const v = Math.round((max / ticks) * i);
    const y = padT + plotH - (plotH * (v / max));
    gridSvg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>`;
    axisLabels += `<text x="${padL-8}" y="${y+4}" text-anchor="end" font-size="11" fill="var(--muted)">${formatNumber(v)}</text>`;
  }

  let bars = '';
  let xLabels = '';
  const step = plotW / series.length;
  series.forEach((s, i) => {
    const barH = max ? (s.value / max) * plotH : 0;
    const x = padL + i * step + (step - barW) / 2;
    const y = padT + plotH - barH;
    bars += `<rect class="chart-bar" data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(barH,2).toFixed(1)}" rx="4" fill="var(--series-1)"></rect>`;
    xLabels += `<text x="${(x+barW/2).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--muted)">${escapeHtml(s.label)}</text>`;
  });

  container.innerHTML = `
    <div class="viz-root" style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block" preserveAspectRatio="xMidYMid meet">
        <line x1="${padL}" y1="${padT+plotH}" x2="${W-padR}" y2="${padT+plotH}" stroke="var(--border, #c3c2b7)" stroke-width="1"/>
        ${gridSvg}
        ${bars}
        ${axisLabels}
        ${xLabels}
      </svg>
      <div class="bar-tooltip" id="chart-tooltip"></div>
    </div>`;

  const tooltip = $('#chart-tooltip', container);
  const svg = $('svg', container);
  $$('.chart-bar', container).forEach((barEl) => {
    const s = series[Number(barEl.dataset.i)];
    barEl.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const scale = rect.width / W;
      const bx = Number(barEl.getAttribute('x')) + Number(barEl.getAttribute('width'))/2;
      const by = Number(barEl.getAttribute('y'));
      tooltip.style.left = (bx * scale) + 'px';
      tooltip.style.top = (by * scale) + 'px';
      tooltip.innerHTML = `<strong>${fmtKm(s.value)}</strong> · ${formatDateLong(s.dateISO)}`;
      tooltip.classList.add('show');
    });
    barEl.addEventListener('mouseleave', () => tooltip.classList.remove('show'));
  });
}
