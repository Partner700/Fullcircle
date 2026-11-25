#!/usr/bin/env python3
"""Build static, chapter-sharded bidirectional reference index. Source: OpenBible.info, CC BY 4.0."""
import bisect, collections, csv, io, json, pathlib, re, urllib.request, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'public'/'scripture-threads'
BOOKS='Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev'.split()
NAMES='Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|1 Samuel|2 Samuel|1 Kings|2 Kings|1 Chronicles|2 Chronicles|Ezra|Nehemiah|Esther|Job|Psalms|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|1 Corinthians|2 Corinthians|Galatians|Ephesians|Philippians|Colossians|1 Thessalonians|2 Thessalonians|1 Timothy|2 Timothy|Titus|Philemon|Hebrews|James|1 Peter|2 Peter|1 John|2 John|3 John|Jude|Revelation'.split('|')
def parse(s):
    m=re.fullmatch(r'([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)',s.strip())
    if not m or m[1] not in BOOKS: return None
    return (BOOKS.index(m[1]),int(m[2]),int(m[3]))
def label(t): return f'{NAMES[t[0]]} {t[1]}:{t[2]}'
def main():
    url='https://a.openbible.info/data/cross-references.zip'
    with urllib.request.urlopen(url,timeout=60) as response: payload=response.read(12000000)
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        name=next(n for n in z.namelist() if n.lower().endswith('.txt'))
        rows=list(csv.reader(io.StringIO(z.read(name).decode('utf-8-sig')),delimiter='\t'))
    edges=[]; keys=set()
    for row in rows:
        if len(row)<3: continue
        origin=parse(row[0]); ends=row[1].split('-'); start=parse(ends[0]); end=parse(ends[-1])
        if not origin or not start or not end or end<start: continue
        try: score=int(row[2])
        except ValueError: continue
        if origin==start==end: continue
        edges.append((origin,start,end,score)); keys.update((origin,start,end))
        if start[:2]==end[:2] and end[2]-start[2]<200:
            keys.update((start[0],start[1],v) for v in range(start[2],end[2]+1))
    assert len(edges)>250000, f'Unexpected source size: {len(edges)}'
    ordered=sorted(keys)
    index=collections.defaultdict(dict)
    def add(a,b,last,score):
        if a==b==last: return
        k=(b,last)
        index[a][k]=max(score,index[a].get(k,-999999))
    for a,b,last,score in edges:
        add(a,b,last,score)
        for v in ordered[bisect.bisect_left(ordered,b):bisect.bisect_right(ordered,last)]:
            add(v,a,a,score)
    chapters=collections.defaultdict(dict)
    for a,links in index.items():
        chapters[a[:2]][str(a[2])]=[[label(b), label(e) if b!=e else '', score] for (b,e),score in sorted(links.items(),key=lambda item:(-item[1],item[0]))]
    OUT.mkdir(parents=True,exist_ok=True)
    for (book,chapter),verses in chapters.items():
        slug=NAMES[book].lower().replace(' ','-')
        folder=OUT/slug; folder.mkdir(exist_ok=True)
        (folder/f'{chapter}.json').write_text(json.dumps(verses,separators=(',',':')),encoding='utf-8')
    manifest={'source':'OpenBible.info / Treasury of Scripture Knowledge','license':'CC BY 4.0','directedSourceRows':len(edges),'indexedVerses':len(index),'chapters':len(chapters)}
    assert len(chapters)>1150 and '1' in chapters[(6,8)]
    (OUT/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
    print(manifest)
if __name__=='__main__': main()
