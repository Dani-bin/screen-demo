<!-- 房间信息：使用面积 / 容纳 / 当前人数（金框三格）+ 今日预约时间轴（08:00～19:00，竖线为当前时间） -->
<template>
  <section>
    <PanelTitle title="房间信息">
      <template #extra>{{ room.id }} · {{ room.name }}</template>
    </PanelTitle>
    <div class="body">
      <div class="box">
        <div>
          <b class="num">{{ info.area }}</b
          ><small>m²</small><span>使用面积</span>
        </div>
        <div>
          <b class="num">{{ info.capacity }}</b
          ><small>人</small><span>容纳</span>
        </div>
        <div>
          <b class="num">{{ info.people }}</b
          ><small>人</small><span>当前人数</span>
        </div>
      </div>
      <div class="sub">今日预约</div>
      <div class="timeline">
        <div class="track">
          <span
            v-for="b in bookings"
            :key="b.title"
            class="bk"
            :class="{ now: hour >= b.from && hour < b.to }"
            :style="{
              left: pct(b.from),
              width: `calc(${pct(b.to)} - ${pct(b.from)})`
            }"
            >{{ b.title }}</span
          >
          <i
            v-if="hour >= T0 && hour <= T1"
            class="cursor"
            :style="{ left: pct(hourF) }"
          ></i>
        </div>
        <div class="ticks num">
          <span>08:00</span><span>13:30</span><span>19:00</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  defineProps({
    room: { type: Object, required: true },
    info: { type: Object, required: true },
    bookings: { type: Array, required: true },
    hour: { type: Number, required: true }
  })

  const T0 = 8
  const T1 = 19
  const now = new Date()
  const hourF = now.getHours() + now.getMinutes() / 60
  const pct = (h) =>
    `${((Math.min(T1, Math.max(T0, h)) - T0) / (T1 - T0)) * 100}%`
</script>

<style lang="scss" scoped>
  .box {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 12px 0;
    border: 1px solid rgba(255, 198, 90, 0.55);
    background: linear-gradient(
      180deg,
      rgba(120, 80, 10, 0.08),
      rgba(120, 80, 10, 0.28)
    );
    text-align: center;

    b {
      font-size: 24px;
      font-weight: normal;
      color: #ffd27a;
    }

    small {
      margin-left: 2px;
      font-size: 11px;
      color: #c9b48a;
    }

    span {
      display: block;
      margin-top: 2px;
      font-size: 12px;
      color: #8aa0bd;
    }
  }

  .sub {
    margin: 14px 0 6px;
    font-size: 12px;
    color: #8aa0bd;
  }

  .track {
    position: relative;
    height: 26px;
    background: rgba(20, 70, 140, 0.25);

    .bk {
      position: absolute;
      top: 3px;
      bottom: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: rgba(47, 125, 255, 0.55);
      font-size: 11px;
      white-space: nowrap;
      color: #fff;

      &.now {
        background: rgba(255, 180, 60, 0.75);
      }
    }

    .cursor {
      position: absolute;
      top: -4px;
      bottom: -4px;
      width: 2px;
      background: #ffc65a;
      box-shadow: 0 0 6px #ffc65a;
    }
  }

  .ticks {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 11px;
    color: #7f93ad;
  }
</style>
