import json, statistics as st, sys
exec(open('analyse.py').read().split('if "--align"')[0])
for r in rows:
    c=cls(r)
    for b in ('', '_bridge6', '_bridge12', '_bridge1000'):
        base = r['checked_qc'+b]
        r['hybrid'+b] = r['combined'] if c=='storm' and r['combined'] is not None else base
    r['sync_bridge6'] = r['checked_bridge6'] if r['station'] in ('sunshine','simpson') else r['ratchet_bridge6']
    r['sync_bridge12'] = r['checked_bridge12'] if r['station'] in ('sunshine','simpson') else r['ratchet_bridge12']
    r['sync_qc_bridge6'] = r['checked_qc_bridge6'] if r['station'] in ('sunshine','simpson') else r['ratchet_bridge6']
ms=sys.argv[1].split(',')
def line(rs,lab):
    out=[lab.ljust(26)]
    for m in ms:
        s=stats(rs,m); out.append(f"{s['mae']:.2f}/{s['me']:+.2f}/{s['off5']}" if s else '-')
    print('  '.join(x.ljust(16) for x in out))
print('  '.join(x.ljust(16) for x in ['MAE/ME/>=5'.ljust(26)]+ms))
groups=[('ALL',None,'all')]+[(k,k,c) for k in NAMES for c in ('all','storm','dry_cold','warm')]
for lab,k,c in groups:
    rs=[r for r in rows if (k is None or r['station']==k) and (c=='all' or cls(r)==c)]
    line(rs,f"{lab} {c} n={len(rs)}")
for c in ('storm','dry_cold','warm'):
    rs=[r for r in rows if cls(r)==c]; line(rs,f"ALL {c} n={len(rs)}")
for season,(a,b) in {'2024-25':('2024-07','2025-07'),'2025-26':('2025-07','2026-07')}.items():
    rs=[r for r in rows if a<=r['date']<b]; line(rs,f'ALL {season} n={len(rs)}')
for g in (True,False):
    rs=[r for r in rows if r['gap']==g]; line(rs,f'gap={g} n={len(rs)}')
