<!--
  中下右：过号名单（常驻，方便过号的人找到自己；最新在前，最多 6 人）
-->
<template>
  <section class="missed">
    <header>
      <span class="pill">过号名单</span>
      <em>请到分诊台重新签到</em>
    </header>
    <ul v-if="items.length">
      <li v-for="m in items.slice(0, 6)" :key="m.no">
        <b>{{ m.no }}</b
        ><span>{{ m.name }}</span
        ><i>{{ m.room }}</i>
      </li>
    </ul>
    <p v-else class="none">暂无过号</p>
  </section>
</template>

<script setup>
  defineProps({ items: { type: Array, required: true } })
</script>

<style lang="scss" scoped>
  @use "../styles/candy" as *;

  .missed {
    @include card;
    position: absolute;
    left: 1162px;
    top: 882px;
    width: 328px;
    height: 162px;
    padding: 14px 16px 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    .pill {
      @include pill($missed);
    }
    em {
      font-style: normal;
      font-size: 12px;
      color: $missed;
    }
  }
  ul {
    display: grid;
    grid-template-columns: 1fr 1fr;
    row-gap: 8px;
    margin-top: 14px;
    padding-left: 4px;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 5px;
    white-space: nowrap;
    b {
      font-family: $num;
      font-weight: normal;
      font-size: 15px;
      color: $missed;
    }
    span {
      font-size: 14px;
      color: $ink;
    }
    i {
      font-style: normal;
      font-family: $num;
      font-size: 12px;
      color: $faint;
    }
  }
  .none {
    margin-top: 30px;
    text-align: center;
    font-size: 15px;
    color: $faint;
  }
</style>
