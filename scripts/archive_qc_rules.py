import gzip,json,glob,pandas as pd,numpy as np,os
S='/tmp/claude-0/-home-claude/cf63846e-474a-5047-b340-03489992ba10/scratchpad/'
OUT=S+'qc/'; os.makedirs(OUT,exist_ok=True)
NOW=pd.Timestamp.now(tz='UTC'); HOLD=NOW-pd.Timedelta(hours=72)   # leave recent hours to the live sync
RIDGE={'fts-bosup','fts-simpup','fts-vulture','fts-whymper','fts-lookout'}
RANGE={'airTempAvg':(-50,40),'airTempMin':(-50,40),'airTempMax':(-50,40),'windSpeedAvg':(0,200),'windSpeedGust':(0,300),
       'windDirAvg':(0,360),'snowHeight':(-5,600),'precipTotal':(0,5000),'precipIncr':(0,50),'newSnow':(0,80)}
SPIKE={'airTempAvg':6,'relativeHumidity':40,'windSpeedAvg':40,'snowHeight':12,'precipTotal':15}
log=[]; summary={}
def mark(a,mask,field,new,rule):
    for i in a.index[mask]:
        if a.at[i,'t']>HOLD: continue
        old=a.at[i,field]
        if pd.isna(old): continue
        key=(i,field)
        if key in done: continue
        done[key]=(new,rule); log.append((sid,a.at[i,'measurementDateTime'],field,old,new,rule))
for f in sorted(glob.glob('audit/fts-*.json.gz')):
    sid=f.split('/')[-1][:-8]; done={}
    a=pd.DataFrame(json.load(gzip.open(f))); a['t']=pd.to_datetime(a.measurementDateTime)
    a=a.sort_values('t').reset_index(drop=True)
    # 1. impossible values / sentinels
    for c,(lo,hi) in RANGE.items():
        if c not in a or (c=='newSnow' and sid=='fts-sunshine'): continue   # Sunshine newSnow is SW (mm) via live parser - not a sensor fault
        mark(a,a[c].notna()&((a[c]<lo)|(a[c]>hi)),c,None,f'range {lo}..{hi}')
    if 'relativeHumidity' in a:
        rh=a.relativeHumidity
        mark(a,rh.notna()&((rh<0)|(rh>105)),'relativeHumidity',None,'range 0..105')
        mark(a,rh.notna()&(rh>100)&(rh<=105),'relativeHumidity',100.0,'clamp >100 to 100')
    # 2. isolated one-reading spikes (far from local median AND both neighbours)
    for c,th in SPIKE.items():
        if c not in a: continue
        x=a[c].copy()
        for (i,ff),(n,_) in done.items():
            if ff==c: x.at[i]=np.nan if n is None else n
        med=x.rolling(5,center=True,min_periods=3).median()
        mark(a,x.notna()&((x-med).abs()>th)&((x-x.shift(1)).abs()>th)&((x-x.shift(-1)).abs()>th),c,None,f'spike >{th}')
    # 3. frozen sensors
    def runs(x,hours,valfilter=None):
        g=(x!=x.shift()).cumsum()
        span=a.groupby(g).t.transform(lambda s:(s.max()-s.min()).total_seconds()/3600)
        m=x.notna()&(span>=hours)
        return m if valfilter is None else m&valfilter(x)
    if 'airTempAvg' in a: mark(a,runs(a.airTempAvg,12),'airTempAvg',None,'frozen temp >=12h')
    if 'relativeHumidity' in a: mark(a,runs(a.relativeHumidity,48,lambda x:x<99),'relativeHumidity',None,'frozen RH >=48h (not 100%)')
    # 4. rimed / iced anemometer at ridge-top stations
    if sid in RIDGE and 'windSpeedAvg' in a:
        z=(a.windSpeedAvg==0)&(a.get('windSpeedGust',pd.Series(0,index=a.index)).fillna(0)==0)
        g=(z!=z.shift()).cumsum(); span=a.groupby(g).t.transform(lambda s:(s.max()-s.min()).total_seconds()/3600)
        zz=z&(span>=5)
        for c in ['windSpeedAvg','windSpeedGust','windDirAvg']:
            if c in a: mark(a,zz,c,None,'rimed anemometer (0 for >=6h)')
    # 5. gust below average
    if 'windSpeedGust' in a and 'windSpeedAvg' in a:
        mark(a,a.windSpeedGust.notna()&a.windSpeedAvg.notna()&(a.windSpeedGust<a.windSpeedAvg-0.5),'windSpeedGust',None,'gust < average')
    patches={}
    for (i,c),(n,_) in done.items():
        iso=a.at[i,'measurementDateTime']; p=patches.setdefault(iso,{'measurementDateTime':iso,'set':{},'expect':{}})
        p['set'][c]=n; p['expect'][c]=float(a.at[i,c])
    if patches:
        json.dump(list(patches.values()),gzip.open(OUT+f'{sid}.json.gz','wt'))
    summary[sid]=len(done)
L=pd.DataFrame(log,columns=['station','measurementDateTime','field','old','new','rule'])
L.to_csv(OUT+'qc-log.csv',index=False)
pd.set_option('display.width',200); pd.set_option('display.max_rows',200)
print(L.groupby(['station','rule']).size().to_string())
print('TOTAL values changed:',len(L),' of which clamps:',int(L.new.notna().sum()))
