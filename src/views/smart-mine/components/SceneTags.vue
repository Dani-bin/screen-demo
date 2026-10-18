<!--
  场景标注：锚点由场景每帧投影成设计稿坐标；按显示方式挑一组标签（地表 / 透视 / 剖切 / 工业广场）。
  引线高度 h 与水平偏移 dx 对照设计稿 docs/design/smart-mine/ 调过，避免主视角下互相遮挡；带 go 的标签点击后切专题
-->
<template>
  <div class="tags">
    <div
      v-for="t in list"
      :key="t.key"
      class="tag"
      :class="[t.cls, { link: t.go }]"
      :style="{
        left: rem(t.x),
        top: rem(t.y),
        '--c': t.c,
        '--h': rem(t.h ?? 46),
        '--dx': t.dx ?? '-50%'
      }"
      @click="t.go && $emit('go', t.go)"
    >
      <span class="stem"></span><span class="pin"></span>
      <div class="box">
        <b>{{ t.title }}</b>
        <p v-if="t.sub">{{ t.sub }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { STATUS, fmt, rem } from "../utils"

  const props = defineProps({
    anchors: { type: Object, default: null },
    /** surface / ghost / section / plant */
    set: { type: String, required: true },
    snap: { type: Object, required: true },
    facts: { type: Object, required: true }
  })
  defineEmits(["go"])

  const SETS = {
    surface: (s, f) => [
      {
        key: "plant",
        c: "#36e0ff",
        h: 96,
        cls: "big",
        title: "工业广场",
        sub: "选煤厂 · 储煤场 · 铁路装车站",
        go: "plant"
      },
      {
        key: "face",
        c: "#ff9a3d",
        h: 110,
        dx: "-72%",
        title: "LW-B05 综采工作面",
        sub: `埋深 ${f.faceDepth} m · 已推进 ${Math.round((s.face.advanced / s.face.panelLen) * 100)}%`,
        go: "underground"
      },
      {
        key: "wells",
        c: "#c6ff5a",
        h: 64,
        dx: "-20%",
        title: "瓦斯抽采钻场",
        sub: `${s.drainage.wells} 处 · 在抽 ${s.drainage.pumping}`,
        go: "ventilation"
      },
      {
        key: "shaft",
        c: "#ff7a6a",
        h: 52,
        dx: "-12%",
        title: "Deer Creek 回风井",
        sub: `主扇回风 ${fmt(s.vent.ret)} m³/min`,
        go: "ventilation"
      },
      { key: "refuse", c: "#b8aef0", h: 38, cls: "mini", title: "矸石场" },
      { key: "somerset", c: "#8ea6c8", cls: "mini flat", title: "Somerset 镇" },
      { key: "river", c: "#5aa8ff", cls: "mini flat", title: "北福克河" }
    ],
    ghost: (s, f) => [
      {
        key: "faceU",
        c: "#ff9a3d",
        h: 150,
        dx: "-78%",
        cls: "big",
        title: "LW-B05 综采工作面",
        sub: `B 煤 · 埋深 ${f.faceDepth} m · 推进 ${fmt(s.face.advanced)} / ${fmt(s.face.panelLen)} m`
      },
      {
        key: "T1",
        c: STATUS[s.gas.t1.st].c,
        h: 78,
        dx: "-6%",
        title: "T1 回风隅角",
        sub: `CH₄ ${s.gas.t1.v.toFixed(2)} % ${STATUS[s.gas.t1.st].t}`
      },
      {
        key: "goaf",
        c: "#b8aef0",
        h: 30,
        cls: "mini",
        title: "采空区 LW-B01 ~ B04"
      },
      {
        key: "ready",
        c: "#53e8f0",
        h: 18,
        dx: "-104%",
        cls: "mini",
        title: "LW-B06 待采"
      },
      {
        key: "planned",
        c: "#53e8f0",
        h: 18,
        dx: "-104%",
        cls: "mini",
        title: "LW-B07 · B08 规划"
      },
      {
        key: "heading",
        c: "#7fd0ff",
        h: 30,
        dx: "-8%",
        cls: "mini",
        title: "LW-B07 运输顺槽掘进头"
      },
      {
        key: "eold",
        c: "#8f8aa8",
        h: 30,
        cls: "mini",
        title: "E 煤老采区（已闭）"
      },
      { key: "mains", c: "#38c8ff", h: 34, cls: "mini", title: "B 煤南翼大巷" },
      { key: "incline", c: "#ffd23a", h: 30, cls: "mini", title: "主暗斜井" },
      {
        key: "shaft",
        c: "#ff6a5a",
        h: 70,
        title: "Deer Creek 回风井",
        sub: `回风 ${fmt(s.vent.ret)} m³/min`
      },
      {
        key: "bleeder",
        c: "#ff6a5a",
        h: 30,
        cls: "mini",
        title: "东翼回风联络巷"
      },
      {
        key: "plant",
        c: "#36e0ff",
        h: 40,
        cls: "mini",
        title: "工业广场（地面）",
        go: "plant"
      }
    ],
    // 通风瓦斯：只标风流路线上的关键点与测点
    vent: (s) => [
      {
        key: "faceU",
        c: "#ff9a3d",
        h: 120,
        dx: "-88%",
        title: "LW-B05 综采工作面",
        sub: `工作面风量 ${fmt(s.vent.faceAir)} m³/min`
      },
      {
        key: "T1",
        c: STATUS[s.gas.t1.st].c,
        h: 70,
        dx: "-6%",
        title: "T1 回风隅角",
        sub: `CH₄ ${s.gas.t1.v.toFixed(2)} % ${STATUS[s.gas.t1.st].t}`
      },
      {
        key: "T2",
        c: "#3ddc97",
        h: 36,
        dx: "-104%",
        cls: "mini",
        title: `T2 回风顺槽 ${s.gas.t2.v.toFixed(2)}%`
      },
      {
        key: "shaft",
        c: "#ff6a5a",
        h: 70,
        title: "Deer Creek 回风井",
        sub: `主扇负压 ${s.vent.pressure.toFixed(2)} kPa · 回风 ${fmt(s.vent.ret)} m³/min`
      },
      {
        key: "mains",
        c: "#38c8ff",
        h: 34,
        cls: "mini",
        title: `南翼大巷 · 进风 ${fmt(s.vent.intake)} m³/min`
      },
      {
        key: "bleeder",
        c: "#ff6a5a",
        h: 30,
        cls: "mini",
        title: "东翼回风联络巷"
      },
      {
        key: "eold",
        c: "#8f8aa8",
        h: 30,
        cls: "mini",
        title: "E 煤老采区（已闭）"
      }
    ],
    section: (s, f) => [
      {
        key: "secFace",
        c: "#ff9a3d",
        h: 96,
        dx: "-12%",
        title: "LW-B05 综采工作面",
        sub: s.face.cutting
          ? `采煤机 #${s.face.shearerAt} · 采高 ${s.face.height} m`
          : "夜班检修"
      },
      {
        key: "secGoaf",
        c: "#b8aef0",
        h: 52,
        dx: "-88%",
        title: "采空区上覆岩层",
        sub: "垮落带 ≈ 50 m · 裂隙带 ≈ 150 m"
      },
      {
        key: "secMains",
        c: "#38c8ff",
        h: 40,
        cls: "mini",
        title: "南翼大巷（进风）"
      },
      {
        key: "secBleeder",
        c: "#ff6a5a",
        h: 40,
        cls: "mini",
        title: "东翼回风联络巷"
      },
      {
        key: "secB",
        c: "#ff9a3d",
        cls: "mini side",
        title: `B 煤 · 埋深 ${f.faceDepth} m`
      },
      { key: "secE", c: "#cfe0f5", cls: "mini side", title: "E 煤（已采）" },
      { key: "secF", c: "#cfe0f5", cls: "mini side", title: "F 煤" }
    ],
    plant: (s) => [
      {
        key: "portal",
        c: "#ffd23a",
        h: 60,
        title: "主平硐",
        sub: `F 煤 · 主运皮带 ${fmt(s.flow.belt)} t/h`
      },
      {
        key: "prep",
        c: "#36e0ff",
        h: 90,
        title: "选煤厂",
        sub: `入洗 ${fmt(s.flow.wash)} t/h`
      },
      {
        key: "rawpile",
        c: "#36e0ff",
        h: 70,
        title: "原煤堆场",
        sub: `${s.flow.rawPile.toFixed(1)} 万 t`
      },
      {
        key: "cleanpile",
        c: "#36e0ff",
        h: 120,
        title: "精煤堆场",
        sub: `${s.flow.cleanPile.toFixed(1)} 万 t`
      },
      {
        key: "loadout",
        c: "#36e0ff",
        h: 64,
        title: "铁路装车站",
        sub: `Union Pacific · 今日 ${s.flow.trains} 列`
      },
      {
        key: "office",
        c: "#8ea6c8",
        h: 40,
        cls: "mini",
        title: "办公区 · 矿灯房"
      },
      { key: "yard", c: "#8ea6c8", h: 34, cls: "mini", title: "材料设备库" },
      { key: "refuse", c: "#b8aef0", h: 56, title: "矸石场" },
      { key: "river", c: "#5aa8ff", cls: "mini flat", title: "北福克河" }
    ]
  }

  const list = computed(() => {
    const a = props.anchors
    if (!a) return []
    return SETS[props.set](props.snap, props.facts)
      .filter((t) => a[t.key]?.visible)
      .map((t) => ({ ...t, x: a[t.key].x, y: a[t.key].y }))
  })
</script>

<style lang="scss" scoped>
  .tags {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }

  .tag {
    position: absolute;
    width: 0;
    height: 0;

    &.link .box {
      pointer-events: auto;
      cursor: pointer;

      &:hover {
        background: rgba(10, 34, 66, 0.92);
      }
    }
  }

  .pin {
    position: absolute;
    left: -5px;
    top: -5px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c);
    box-shadow:
      0 0 0 4px color-mix(in srgb, var(--c) 25%, transparent),
      0 0 14px var(--c);
  }

  .stem {
    position: absolute;
    left: -0.5px;
    bottom: 0;
    width: 1px;
    height: var(--h);
    background: linear-gradient(
      0deg,
      var(--c),
      color-mix(in srgb, var(--c) 20%, transparent)
    );
  }

  .box {
    position: absolute;
    left: 0;
    bottom: var(--h);
    padding: 4px 10px 5px;
    white-space: nowrap;
    font-size: 14px;
    border: 1px solid color-mix(in srgb, var(--c) 60%, transparent);
    border-top: 2px solid var(--c);
    border-radius: 2px;
    background: rgba(3, 12, 26, 0.82);
    box-shadow: 0 0 16px color-mix(in srgb, var(--c) 22%, transparent);
    transform: translateX(var(--dx));

    b {
      font-weight: normal;
    }

    p {
      margin: 1px 0 0;
      font-size: 12px;
      color: var(--sub);
    }
  }

  .big .box {
    padding: 6px 14px 7px;
    font-size: 17px;

    b {
      font-family: "Alimama ShuHeiTi", sans-serif;
      letter-spacing: 1px;
    }
  }

  .mini .box {
    padding: 2px 8px;
    font-size: 13px;
    border-top-width: 1px;
    background: rgba(3, 12, 26, 0.7);
  }

  /* 标签在锚点正下方（地名） */
  .flat {
    .box {
      top: 8px;
      bottom: auto;
      border-top-width: 1px;
    }

    .stem {
      display: none;
    }
  }

  /* 标签在锚点左侧（剖切面上的煤层） */
  .side {
    .box {
      top: 0;
      bottom: auto;
      transform: translate(calc(-100% - 12px), -50%);
    }

    .stem {
      display: none;
    }
  }
</style>
