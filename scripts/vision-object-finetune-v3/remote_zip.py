"""Bounded public HTTPS ZIP range reader; preserves TLS, fails on ignored ranges.

Only extracted members have CRC checked. The publisher's full archive SHA is
recorded, never presented as fully verified when only ranges were transferred.
"""
import io,re,urllib.request

class RemoteZip(io.RawIOBase):
    def __init__(self,url,size,max_bytes=1_500_000_000):
        self.url=url;self.size=size;self.pos=0;self.transferred=0;self.max_bytes=max_bytes
    def seekable(self):return True
    def readable(self):return True
    def tell(self):return self.pos
    def seek(self,offset,whence=0):
        target=offset if whence==0 else self.pos+offset if whence==1 else self.size+offset
        if not 0<=target<=self.size:raise ValueError('Invalid archive offset')
        self.pos=target;return target
    def read(self,n=-1):
        if self.pos==self.size:return b''
        n=self.size-self.pos if n<0 else min(n,self.size-self.pos)
        if n==0:return b''
        if n>64*1024*1024 or self.transferred+n>self.max_bytes:raise ValueError('Remote ZIP byte budget')
        start=self.pos;end=start+n-1
        request=urllib.request.Request(self.url,headers={'User-Agent':'BasiraResearch/3','Range':f'bytes={start}-{end}'})
        with urllib.request.urlopen(request,timeout=60) as response:
            expected=f'bytes {start}-{end}/{self.size}'
            if response.status!=206 or response.headers.get('Content-Range')!=expected:
                raise ValueError('Public server did not honour the exact byte range')
            raw=response.read(n+1)
            if len(raw)!=n:raise ValueError('Truncated archive range')
            self.url=response.url # ephemeral redirect stays in memory, never in evidence/logs
        self.transferred+=len(raw);self.pos+=len(raw);return raw
