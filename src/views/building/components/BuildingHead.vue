<!--
  数字楼宇顶栏（1920 × 80）：中间标题，左侧时间与返回演示中心，右侧五级钻取路径。
  顶栏底图沿用射阳应急大屏的顶栏切图。
-->
<template>
  <div class="building-head">
    <img class="head-outer" src="../assets/head-outer.svg" alt="" />
    <div class="head-inner">
      <img class="head-inner-fill" src="../assets/head-inner-fill.svg" alt="" />
      <img
        class="head-inner-border"
        src="../assets/head-inner-border.svg"
        alt=""
      />
      <img class="head-title-deco" src="../assets/title-deco.png" alt="" />
      <h1 class="head-title">{{ title }}</h1>
    </div>

    <div class="head-left">
      <span class="time num">{{ timeText }}</span>
      <span class="week">{{ weekText }}</span>
      <router-link class="back" to="/home">返回演示中心</router-link>
    </div>

    <!-- 五级钻取：城市 → 园区 → 楼宇 → 楼层 → 房间；当前级高亮，未开放的级别置灰 -->
    <div class="head-levels">
      <template v-for="(lv, i) in levels" :key="lv.key">
        <span v-if="i" class="sep">›</span>
        <span
          class="level"
          :class="{
            active: lv.key === current,
            done: i < currentIndex,
            todo: i > currentIndex,
            link: lv.ready && lv.key !== current
          }"
          :title="lv.ready ? lv.label : `${lv.label}（建设中）`"
          @click="lv.ready && $emit('go', lv.key)"
        >
          <i>{{ i + 1 }}</i
          >{{ lv.name }}
        </span>
      </template>
    </div>
  </div>
</template>

<script setup>
  const props = defineProps({
    title: { type: String, default: "" },
    /** 当前所在级别 key */
    current: { type: String, default: "city" },
    /** 级别列表 [{ key, name, label, ready }]，ready 为已实现、可点击跳转的级别 */
    levels: { type: Array, default: () => [] }
  })
  defineEmits(["go"])

  const currentIndex = computed(() =>
    props.levels.findIndex((l) => l.key === props.current)
  )

  const WEEK = [
    "星期日",
    "星期一",
    "星期二",
    "星期三",
    "星期四",
    "星期五",
    "星期六"
  ]
  const pad = (n) => String(n).padStart(2, "0")
  const timeText = ref("")
  const weekText = ref("")
  function tick() {
    const d = new Date()
    timeText.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    weekText.value = WEEK[d.getDay()]
  }
  tick()
  const timer = setInterval(tick, 1000)
  onUnmounted(() => clearInterval(timer))
</script>

<style lang="scss" scoped>
  .building-head {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 20;
    width: 1920px;
    height: 80px;
    pointer-events: none;
  }

  .head-outer {
    position: absolute;
    inset: 0 0 -1px 0;
    width: 100%;
    height: 81px;
  }

  .head-inner {
    position: absolute;
    left: 594px;
    top: 0;
    width: 731px;
    height: 82px;

    .head-inner-fill,
    .head-inner-border {
      position: absolute;
      left: 0;
      top: 0;
      width: 731px;
      height: 78px;
    }

    .head-title-deco {
      position: absolute;
      left: 50%;
      bottom: 3px;
      width: 408px;
      height: 56px;
      transform: translateX(-50%);
      object-fit: contain;
      object-position: bottom;
      opacity: 0.8;
    }
  }

  .head-title {
    position: absolute;
    left: 50%;
    top: 16px;
    margin: 0;
    transform: translateX(-50%);
    font-family: "Alimama ShuHeiTi", sans-serif;
    font-size: 36px;
    font-weight: bold;
    letter-spacing: 6px;
    white-space: nowrap;
    background-image: linear-gradient(to bottom, #ffffff, #b1cfff);
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 0 10px #222c3b);
  }

  .head-left {
    position: absolute;
    left: 20px;
    top: 26px;
    display: flex;
    align-items: center;
    gap: 10px;
    color: #def;
    pointer-events: auto;

    .time {
      font-size: 17px;
    }

    .week {
      font-size: 14px;
    }

    .back {
      margin-left: 14px;
      padding: 3px 12px;
      border: 1px solid rgba(74, 144, 226, 0.45);
      border-radius: 2px;
      background: rgba(10, 40, 90, 0.5);
      font-size: 13px;
      color: #9cc8ff;
      text-decoration: none;

      &:hover {
        color: #fff;
        border-color: #4aa8ff;
      }
    }
  }

  .head-levels {
    position: absolute;
    right: 22px;
    top: 24px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    color: rgba(170, 200, 235, 0.55);
    pointer-events: auto;

    .sep {
      color: rgba(120, 170, 230, 0.5);
    }

    .level {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px 3px 4px;
      border: 1px solid transparent;
      border-radius: 2px;

      i {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(60, 110, 180, 0.35);
        font-family: "DIN", sans-serif;
        font-size: 12px;
        font-style: normal;
      }

      &.active {
        border-color: rgba(64, 196, 255, 0.7);
        background: linear-gradient(
          180deg,
          rgba(20, 110, 220, 0.55),
          rgba(10, 50, 120, 0.55)
        );
        color: #fff;
        box-shadow: 0 0 12px rgba(40, 160, 255, 0.35);

        i {
          background: #2de2e6;
          color: #04203a;
        }
      }

      &.done {
        color: #9cc8ff;
      }

      &.link {
        cursor: pointer;

        &:hover {
          border-color: rgba(64, 196, 255, 0.45);
          color: #fff;
        }
      }
    }
  }
</style>
