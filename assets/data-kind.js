/* Raw vs interpreted markers for the module-built views (pair panes, snow profiles). Ben, 2026-11-12.
   index.html and mobile.html carry the same labels inline (dkTag); styles in assets/data-kind.css. */
export const DATA_KIND = {
  raw: {label: 'Raw', short: 'R', title: 'Raw: read straight from the station sensors or a field observation. Bad readings are filtered out; totals, averages and peaks of raw readings stay raw.'},
  interp: {label: 'Interpreted', short: 'I', title: "Interpreted: worked out by the site's rules or a model from the raw readings, not measured directly."}
};

export function dataKindTag(kind, mini = false) {
  const k = DATA_KIND[kind];
  const tag = document.createElement('span');
  tag.className = `dk-tag dk-${kind}${mini ? ' dk-mini' : ''}`;
  tag.title = k.title;
  tag.textContent = mini ? k.short : k.label;
  return tag;
}

/* Pair-pane series: HN bars/totals and HSΔ come from the HN rules; HS depth and gauge HW are readings.
   Temperature and wind get no tag (Ben, 2026-11-12: tags on snow and precip values only), so this returns null. */
export function seriesDataKind(series) {
  if (series.kind === 'temp' || series.kind === 'wind') return null;
  if (series.kind === 'delta') return 'interp';
  if ((series.kind === 'bar' || series.kind === 'cum') && series.unit === 'cm') return 'interp';
  return 'raw';
}
