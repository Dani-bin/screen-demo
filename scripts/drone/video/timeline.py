"""
无人机巡检监控平台解说视频：时间轴与字幕
----------------------------------------------------------
口播文案按段落排时间：每段时长 = 朗读字数 / 语速 + 段尾停顿。配音由用户在剪映里做（文本朗读或自己录），
这里按每秒约 6 个字（剪映文本朗读 1.1–1.2 倍速左右）排，剪映里可微调语速对齐。做法同智能矿山（scripts/smart-mine/video/）。

输出（git 忽略的 models/drone/video/）：
  - timeline.json：各段起止时间，录制脚本 record.mjs 与合成脚本 compose.py 都按它来
  - out/字幕.srt：按标点切成短句的字幕，时长按字数在段内分配（去掉句末逗号句号，保留问号）

用法：python scripts/drone/video/timeline.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VIDEO = ROOT / "models" / "drone" / "video"

CHARS_PER_SEC = 6.0  # 语速
GAP = 0.5  # 段尾停顿（秒）
MAX_LINE = 17  # 每条字幕最多字数

# 口播文案（| 为字幕手动断句点，不念出来）；key 供镜头表 shots.json 引用
SEGMENTS = [
    ("hook", "下午两点零一分，化工厂里有一处管道在漏气。人还没发现，无人机已经先看到了。"),
    (
        "intro",
        "这是我做的一块无人机巡检监控大屏。整个化工园区是三维还原的：储罐、反应塔、管廊，连江上停的化学品船都有。",
    ),
    (
        "fleet",
        "园区里有四座无人机机场，一个机场驻一架无人机，每天按计划自动起飞巡检，一共四十九趟，不用人去按起飞键。",
    ),
    (
        "ir",
        "重点来了。无人机在空中，AI 识别出这里有可燃气体泄漏，浓度五万二千 ppm·m。它没有凑上去，而是停在|两百多米外的上风向悬停监视。右下角就是它实时传回来的红外画面，这一团深紫色，就是泄漏的气体。",
    ),
    (
        "dispatch",
        "值班员这边：看画面确认、一键派单，系统同时联动消防站。待确认、已派单、处置中、待复核、已办结，每个事件都有完整闭环，一条都漏不掉。",
    ),
    (
        "wind",
        "风一大，阵风超过十二米每秒，机场自动锁死、不让起飞；离线的机场也会单独标出来。底下这条时间轴还能拖，一整天飞了哪、出了什么事，都能回放。",
    ),
    (
        "tech",
        "三维模型是用 Blender 脚本一点点搭出来的，网页里直接打开就能跑，帧率稳定在六十。园区和数据都是虚构的演示。",
    ),
    ("end", "你觉得这种无人值守巡检，几年内能在工厂里普及吗？评论区聊聊。"),
]


def spoken_len(s):
    """朗读长度：汉字 1，英文单词按 1.5 个字，标点和断句符不计"""
    han = len(re.findall(r"[一-鿿]", s))
    words = len(re.findall(r"[A-Za-z]+", s))
    return han + words * 1.5


def best_cut(p):
    """过长短句的切分点：从中间往两边找，优先顿号、空格之后，不切在英文单词中间"""
    mid = len(p) // 2
    for off in range(len(p)):
        for c in (mid - off, mid + off):
            if 1 <= c < len(p) and (p[c - 1] == "、" or p[c] == " "):
                return c
    for off in range(len(p)):
        for c in (mid - off, mid + off):
            if 1 <= c < len(p) and not (p[c - 1].isascii() and p[c - 1].isalpha() and p[c].isascii() and p[c].isalpha()):
                return c
    return mid


def split_lines(text):
    """按句读切短句（顿号不切，列举的词放一条），过长的再对半切；太短的并到前一句（不超过字数上限）"""
    parts = [p.strip() for p in re.split(r"(?<=[，。；：？！])|\|", text) if p.strip()]
    lines = []
    for p in parts:
        while len(p) > MAX_LINE:
            c = best_cut(p)
            lines.append(p[:c].strip())
            p = p[c:].strip()
        lines.append(p)
    merged = []
    for ln in lines:
        if merged and spoken_len(ln) <= 3 and len(merged[-1]) + len(ln) <= MAX_LINE:
            merged[-1] += ln
        else:
            merged.append(ln)
    return merged


def clean(line):
    """字幕去掉句末的逗号、句号、分号、冒号、顿号，保留问号"""
    return re.sub(r"[，。；：、]+$", "", line)


def srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    (VIDEO / "out").mkdir(parents=True, exist_ok=True)
    t = 0.0
    segs = []
    subs = []
    for key, text in SEGMENTS:
        speak = spoken_len(text) / CHARS_PER_SEC
        start = t
        lines = split_lines(text)
        total = sum(spoken_len(x) for x in lines)
        lt = start
        cues = []
        for ln in lines:
            d = speak * spoken_len(ln) / total
            subs.append((lt, lt + d, clean(ln)))
            cues.append({"at": round(lt - start, 3), "text": clean(ln)})
            lt += d
        t = start + speak + GAP
        segs.append({"key": key, "start": round(start, 3), "end": round(t, 3), "text": text.replace("|", ""), "cues": cues})
    timeline = {"fps": 30, "duration": round(t + 1.0, 3), "segments": segs}
    (VIDEO / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=1), "utf-8")
    srt = "\n".join(f"{i + 1}\n{srt_time(a)} --> {srt_time(b)}\n{s}\n" for i, (a, b, s) in enumerate(subs))
    # 剪映导入 SRT 认 UTF-8 BOM
    (VIDEO / "out" / "字幕.srt").write_text(srt, "utf-8-sig")
    for s in segs:
        print(f'{s["key"]:9s} {s["start"]:6.2f} – {s["end"]:6.2f}  ({s["end"] - s["start"]:.1f} s)')
        for c in s["cues"]:
            print(f'          +{c["at"]:5.2f}  {c["text"]}')
    print(f"总长 {timeline['duration']:.1f} s，字幕 {len(subs)} 条")


if __name__ == "__main__":
    main()
