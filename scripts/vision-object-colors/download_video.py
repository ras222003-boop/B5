"""CC0 Commons video only, bounded public download with source evidence retained."""
from pathlib import Path
import urllib.request,re,html,json,hashlib,sys
def download(page_url,output,author):
    if not page_url.startswith('https://commons.wikimedia.org/wiki/File:'):raise ValueError('Original Commons file page required')
    get=lambda url:urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BasiraLocalResearch/1.0'}),timeout=45)
    page=get(page_url).read(3*1024*1024).decode('utf-8')
    if 'creativecommons.org/publicdomain/zero/1.0' not in page:raise ValueError('CC0 license could not be verified')
    links=[html.unescape(x).split('?')[0] for x in re.findall(r'href="([^"]+)"',page) if x.startswith('https://upload.wikimedia.org/wikipedia/commons/') and '.webm' in x and '/transcoded/' not in x]
    if not links:raise ValueError('Original video missing')
    raw=get(links[0]).read(100*1024*1024+1)
    if len(raw)>100*1024*1024:raise ValueError('100 MiB resource bound exceeded')
    output=Path(output).resolve()
    if output.exists():raise ValueError('Do not overwrite original media')
    output.write_bytes(raw)
    output.with_suffix('.rights.json').write_text(json.dumps(dict(sourcePage=page_url,download=links[0],license='https://creativecommons.org/publicdomain/zero/1.0/',author=author,sourcePageSha256=hashlib.sha256(page.encode()).hexdigest(),sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),humanApprovalCreated=False),indent=2),encoding='utf-8')
    print(json.dumps(dict(path=str(output),bytes=len(raw))))
if __name__=='__main__':download(*sys.argv[1:])
