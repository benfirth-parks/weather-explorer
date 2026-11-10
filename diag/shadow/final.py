import json
exec(open('analyse.py').read().split('if "--align"')[0])
for r in rows:
    g = r['station'] in ('sunshine','simpson')
    r['sync_bridge12'] = r['checked_bridge12'] if g else r['ratchet_bridge12']
    r['cand'] = r['checked_bridge12'] if g else r['step1_bridge12']
M=[('sheet_sync','Sheet sync now'),('checked','Explorer now'),('delta','Delta'),('raw_sum','Raw Sum'),('combined','Combined'),('hgate6','Temp gate 6 h'),('checked_qc','Explorer + rate QC'),('sync_bridge12','Sheet + 12 h gap bridge'),('cand','Candidate')]
def tab(groups):
    hdr='| Method | '+' | '.join(g[0] for g in groups)+' |'
    print(hdr); print('|'+'---|'*(len(groups)+1))
    for m,lab in M:
        cells=[]
        for _,rs in groups:
            s=stats(rs,m); cells.append(f"{s['me']:+.1f} / {s['mae']:.1f} / {s['off5']}" if s else '–')
        print(f'| {lab} | '+' | '.join(cells)+' |')
    print()
tab([(f'All days (n={len(rows)})',rows)]+[(f'{c} (n={sum(cls(r)==c for r in rows)})',[r for r in rows if cls(r)==c]) for c in ('storm','dry_cold','warm')])
tab([(f'{NAMES[k]} (n={sum(r["station"]==k for r in rows)})',[r for r in rows if r['station']==k]) for k in NAMES])
tab([(f'{NAMES[k]} storm',[r for r in rows if r['station']==k and cls(r)=='storm']) for k in NAMES])
tab([('Gap > 90 min (n=%d)'%sum(r['gap'] for r in rows),[r for r in rows if r['gap']]),('No gap',[r for r in rows if not r['gap']]),('2024-25',[r for r in rows if r['date']<'2025-07']),('2025-26',[r for r in rows if r['date']>'2025-07'])])
import collections
print(collections.Counter(r['station'] for r in rows if r['gap']))
