/* Clickable chart legends: clicking (or Enter/Space on) a legend entry shows or hides its series.
   At least one series always stays visible. What a viewer hides is remembered per legend `key`
   for the page session, so re-rendering a chart (new range, refresh, re-selection) keeps it hidden.
   Axes set to display:'auto' disappear with their last visible series. */
(function () {
  const hiddenByKey = new Map();
  function hiddenSet(key) {
    let set = hiddenByKey.get(key);
    if (!set) { set = new Set(); hiddenByKey.set(key, set); }
    return set;
  }
  function visibleCount(chart) {
    let n = 0;
    chart.data.datasets.forEach((_, i) => { if (chart.isDatasetVisible(i)) n++; });
    return n;
  }
  function paint(entry, on) {
    entry.classList.toggle('legend-off', !on);
    entry.setAttribute('aria-pressed', String(on));
    entry.title = on ? 'Click to hide this series' : 'Click to show this series';
  }
  /* entries[i] is the legend element for chart dataset i; names[i] is its stable name. */
  window.bindLegendToggles = function (chart, entries, names, key) {
    if (!chart || !entries.length) return;
    const hidden = hiddenSet(key);
    entries.forEach((entry, i) => { if (hidden.has(names[i])) chart.setDatasetVisibility(i, false); });
    // A remembered selection that hides everything here (e.g. different stations now) shows all.
    if (!visibleCount(chart)) entries.forEach((_, i) => chart.setDatasetVisibility(i, true));
    chart.update('none');
    entries.forEach((entry, i) => {
      entry.classList.add('legend-toggle');
      entry.setAttribute('role', 'button');
      entry.tabIndex = 0;
      paint(entry, chart.isDatasetVisible(i));
      const flip = event => {
        event.preventDefault();
        event.stopPropagation();
        const on = chart.isDatasetVisible(i);
        if (on && visibleCount(chart) <= 1) {
          entry.classList.remove('legend-nudge'); void entry.offsetWidth; entry.classList.add('legend-nudge');
          return;
        }
        chart.setDatasetVisibility(i, !on);
        if (on) hidden.add(names[i]); else hidden.delete(names[i]);
        paint(entry, !on);
        chart.update('none');
      };
      entry.addEventListener('click', flip);
      entry.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') flip(event); });
    });
  };
  /* For Chart.js's built-in legend: the default click toggle, but never hides the last series. */
  window.keepOneLegendClick = function (event, item, legend) {
    const chart = legend.chart, i = item.datasetIndex;
    if (chart.isDatasetVisible(i) && visibleCount(chart) <= 1) return;
    chart.setDatasetVisibility(i, !chart.isDatasetVisible(i));
    chart.update();
  };
})();
