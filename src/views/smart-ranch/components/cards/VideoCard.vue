<!-- 视频监控：场部与饮水点的 360° 摄像头，四路画面（近景概念图裁切，示意）；告警现场那路描红 -->
<template>
  <Card
    title="视频监控"
    :hint="`在线 ${layout.cameras.length}/${layout.cameras.length} · 画面为示意`"
    class="video"
  >
    <div class="vids">
      <figure
        v-for="c in cams"
        :key="c.id"
        class="vid"
        :class="{ al: c.alarm, on: c.id === focus }"
      >
        <img :src="c.img" :style="{ objectPosition: c.pos }" alt="" />
        <figcaption>
          <b>{{ c.id }}</b
          >{{ c.at }}
        </figcaption>
        <span class="rec">● {{ state.t.hms }}</span>
      </figure>
    </div>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"

  const props = defineProps({
    state: { type: Object, required: true },
    layout: { type: Object, required: true },
    alarm: { type: Object, default: null },
    imgs: { type: Array, required: true },
    /** 被"查看视频"点亮的那一路 */
    focus: { type: String, default: "" }
  })
  const cams = computed(() => {
    const a = props.alarm
    const live = a && ["fence", "stray", "water"].includes(a.kind)
    return [
      { id: "CAM-01", at: "场部 HQ-01", img: props.imgs[0], pos: "18% 22%" },
      {
        id: "CAM-08",
        at: live
          ? `${a.kind === "water" ? a.target : "告警现场"} · ${a.paddock || a.target}`
          : "饮水点 WP-14",
        img: props.imgs[1],
        pos: "70% 30%",
        alarm: live
      },
      { id: "CAM-05", at: "饮水点 WP-05", img: props.imgs[0], pos: "50% 62%" },
      { id: "CAM-06", at: "饮水点 WP-08", img: props.imgs[1], pos: "28% 70%" }
    ]
  })
</script>
