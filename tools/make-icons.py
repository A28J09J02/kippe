# Draws the app icons (wooden tilt board with a hole, a red and a blue ball) into icons/.
from PIL import Image, ImageDraw, ImageFilter
import pathlib
out=pathlib.Path(__file__).resolve().parent.parent/"icons"; out.mkdir(exist_ok=True)
def icon(size, maskable=False, bg=True):
    S=size*4  # supersample
    im=Image.new("RGBA",(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    pad=0 if not maskable else int(S*.0)
    if bg: d.rectangle([0,0,S,S],fill=(28,34,41,255)) if maskable else d.rounded_rectangle([0,0,S-1,S-1],radius=int(S*.22),fill=(28,34,41,255))
    inset=int(S*(.2 if maskable else .12))
    x0,y0,x1,y1=inset,inset,S-inset,S-inset
    # shadow
    sh=Image.new("RGBA",(S,S),(0,0,0,0));ImageDraw.Draw(sh).rounded_rectangle([x0+S*.02,y0+S*.04,x1+S*.02,y1+S*.04],radius=int(S*.07),fill=(0,0,0,140))
    im=Image.alpha_composite(im,sh.filter(ImageFilter.GaussianBlur(S*.025)));d=ImageDraw.Draw(im)
    d.rounded_rectangle([x0,y0,x1,y1],radius=int(S*.07),fill=(91,61,34,255))
    f=int((x1-x0)*.08)
    d.rectangle([x0+f,y0+f,x1-f,y1-f],fill=(212,170,110,255))
    w=(x1-x0-2*f)
    for k in range(1,6):
        y=y0+f+w*k/6; d.line([x0+f,y,x1-f,y],fill=(190,148,88,255),width=max(2,S//200))
    cx,cy=(x0+x1)/2,(y0+y1)/2; r=w*.11
    d.ellipse([cx-r*1.15,cy-r*1.15,cx+r*1.15,cy+r*1.15],fill=(150,105,55,255))
    d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=(20,14,8,255))
    def ball(bx,by,col,hi):
        br=w*.12
        d.ellipse([bx-br+S*.006,by-br+S*.012,bx+br+S*.006,by+br+S*.012],fill=(60,35,10,120))
        d.ellipse([bx-br,by-br,bx+br,by+br],fill=col)
        d.ellipse([bx-br*.55,by-br*.6,bx-br*.1,by-br*.25],fill=hi)
    ball(x0+f+w*.16,y1-f-w*.16,(226,81,59,255),(255,211,201,255))
    ball(x1-f-w*.16,y0+f+w*.16,(42,95,214,255),(214,226,255,255))
    return im.resize((size,size),Image.LANCZOS)
icon(192).save(out/"icon-192.png"); icon(512).save(out/"icon-512.png")
icon(512,maskable=True).save(out/"icon-maskable-512.png")
icon(180,maskable=True).convert("RGB").save(out/"apple-touch-icon.png")
icon(64).save(out/"favicon.png")
print("ok")
