from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import sys
SP=sys.argv[1]; FD='/Users/zhangjiabin/Desktop/Company/bi-demo/src/assets/fonts/'
TITLE=FD+'AlimamaShuHeiTi-Bold.ttf'; BODY=FD+'SourceHanSansCN-Regular.otf'
GOLD=(255,200,96); CYAN=(70,226,255); WHITE=(255,255,255)
hero=Image.open(sys.argv[2] if len(sys.argv) > 2 else SP+'/hero_a.png').convert('RGB')
hero=ImageEnhance.Contrast(ImageEnhance.Brightness(hero).enhance(1.08)).enhance(1.06)

def glow_text(base,xy,text,font,fill,glow,radius=18,stroke=0,anchor='la'):
    layer=Image.new('RGBA',base.size,(0,0,0,0)); d=ImageDraw.Draw(layer)
    d.text(xy,text,font=font,fill=glow+(255,),anchor=anchor,stroke_width=stroke+6,stroke_fill=glow+(255,))
    layer=layer.filter(ImageFilter.GaussianBlur(radius))
    base.alpha_composite(layer)
    d=ImageDraw.Draw(base)
    d.text(xy,text,font=font,fill=fill,anchor=anchor,stroke_width=stroke,stroke_fill=(10,20,40))

def gradient(size,stops):
    # 竖向渐变遮罩：stops=[(y比例, alpha)]
    w,h=size; g=Image.new('L',(1,h))
    for y in range(h):
        t=y/(h-1)
        for (t0,a0),(t1,a1) in zip(stops,stops[1:]):
            if t0<=t<=t1: g.putpixel((0,y),int(a0+(a1-a0)*(t-t0)/((t1-t0) or 1))); break
    return g.resize((w,h))

def badge(base,xy,text,font,pad=(28,12)):
    d=ImageDraw.Draw(base); x,y=xy
    b=d.textbbox((0,0),text,font=font); w,h=b[2]-b[0]+pad[0]*2,b[3]-b[1]+pad[1]*2
    sh=Image.new('RGBA',base.size,(0,0,0,0)); ImageDraw.Draw(sh).rounded_rectangle((x,y,x+w,y+h),12,fill=GOLD+(200,))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(16)))
    d.rounded_rectangle((x,y,x+w,y+h),12,fill=(255,196,80))
    d.text((x+pad[0]-b[0],y+pad[1]-b[1]),text,font=font,fill=(40,22,0))
    return w,h

def steps(base,x,y,font,gap=14,lit=2):
    # 五级进度：城市、园区已上线（亮），楼宇 / 楼层 / 房间待更新（暗）
    d=ImageDraw.Draw(base); names=['城市','园区','楼宇','楼层','房间']; cx=x
    for i,n in enumerate(names):
        on=i<lit
        b=d.textbbox((0,0),n,font=font); w=b[2]-b[0]+36; h=b[3]-b[1]+20
        d.rounded_rectangle((cx,y,cx+w,y+h),h//2,fill=(20,120,170,230) if on else (20,32,56,200),outline=CYAN if on else (70,90,120),width=2)
        d.text((cx+18-b[0],y+10-b[1]),n,font=font,fill=WHITE if on else (120,140,170))
        cx+=w
        if i<4:
            # 手画箭头（字体里的 › 会显示成逗号）
            ax,ay=cx+gap//2+7,y+h//2; col=CYAN if i<lit-1 else (90,110,140)
            d.line([(ax-5,ay-8),(ax+3,ay),(ax-5,ay+8)],fill=col,width=3); cx+=gap+14
    return cx

# ---------- 竖版 3:4（1080×1440，抖音主页 / 推荐流）
W,H=1080,1440
src=hero.crop((1060,0,1060+1920,2160*1920//1920)) if False else hero.crop((1000,0,2620,2160))
cv=src.resize((W,int(src.height*W/src.width))).crop((0,0,W,H)).convert('RGBA')
dark=Image.new('RGBA',(W,H),(2,8,24,255))
cv=Image.composite(dark,cv,gradient((W,H),[(0,170),(0.16,0),(0.5,0),(0.72,215),(1,250)]))
d=ImageDraw.Draw(cv)
badge(cv,(56,60),'第一期',ImageFont.truetype(TITLE,54))
d.text((W-56,96),'数字楼宇 · 五级钻取',font=ImageFont.truetype(BODY,32),fill=(190,215,240),anchor='rm')
ft=ImageFont.truetype(TITLE,112)
glow_text(cv,(60,1010),'我把成都',ft,WHITE,(40,140,255),20)
glow_text(cv,(60,1140),'双子塔',ft,GOLD,(255,150,40),22)
glow_text(cv,(60+3*112+20,1140),'搬进了大屏',ImageFont.truetype(TITLE,80),WHITE,(40,140,255),18,anchor='la')
d=ImageDraw.Draw(cv)
d.text((62,1272),'从整个高新区，一路飞进金融城双子塔',font=ImageFont.truetype(BODY,36),fill=(200,225,245))
steps(cv,60,1340,ImageFont.truetype(BODY,30))
cv.convert('RGB').save(SP+'/ep1-cover-3x4.png')

# ---------- 横版 4:3（1440×1080，横屏视频封面）
W,H=1440,1080
# 从原图（3840×2160）裁 4:3：起点偏左，让双子塔落在画面右半边，左侧留给标题
src=hero.crop((160,0,160+2880,2160))
cv=src.resize((W,H)).convert('RGBA')
m=Image.new('L',(W,1))
for x in range(W): m.putpixel((x,0),int(max(0,min(235,235*(1-(x-300)/440)))))
cv=Image.composite(dark.resize((W,H)),cv,m.resize((W,H)))
d=ImageDraw.Draw(cv)
bw,bh=badge(cv,(72,84),'第一期',ImageFont.truetype(TITLE,52))
d.text((72+bw+24,84+bh//2),'数字楼宇 · 五级钻取',font=ImageFont.truetype(BODY,30),fill=(190,215,240),anchor='lm')
glow_text(cv,(68,300),'我把成都',ImageFont.truetype(TITLE,112),WHITE,(40,140,255),20)
glow_text(cv,(68,438),'双子塔',ImageFont.truetype(TITLE,136),GOLD,(255,150,40),24)
glow_text(cv,(68,604),'搬进了大屏',ImageFont.truetype(TITLE,92),WHITE,(40,140,255),18)
d=ImageDraw.Draw(cv)
d.text((72,744),'从整个高新区，一路飞进金融城双子塔',font=ImageFont.truetype(BODY,34),fill=(200,225,245))
steps(cv,72,820,ImageFont.truetype(BODY,30))
cv.convert('RGB').save(SP+'/ep1-cover-4x3.png')

# ---------- 合集封面 1:1（1080×1080）：不标期数，五级全部点亮，表示整个系列
W,H=1080,1080
# 正方形裁切：双子塔居中偏上，下方留给标题
src=hero.crop((900,0,900+2160,2160))
cv=src.resize((W,H)).convert('RGBA')
cv=Image.composite(dark.resize((W,H)),cv,gradient((W,H),[(0,150),(0.14,0),(0.48,0),(0.68,215),(1,250)]))
d=ImageDraw.Draw(cv)
badge(cv,(56,52),'合集',ImageFont.truetype(TITLE,46))
d.text((W-56,84),'三维大屏实战系列',font=ImageFont.truetype(BODY,30),fill=(190,215,240),anchor='rm')
glow_text(cv,(W//2,790),'数字楼宇',ImageFont.truetype(TITLE,150),WHITE,(40,140,255),24,anchor='ms')
d=ImageDraw.Draw(cv)
sub=ImageFont.truetype(BODY,38)
d.text((W//2,860),'从城市一路钻进房间',font=sub,fill=GOLD,anchor='ms')
# 五级进度条居中：先量宽度再画
tmp=Image.new('RGBA',(W,H)); wsteps=steps(tmp,0,0,ImageFont.truetype(BODY,32),lit=5)
steps(cv,(W-wsteps)//2,920,ImageFont.truetype(BODY,32),lit=5)
cv.convert('RGB').save(SP+'/series-cover-1x1.png')
