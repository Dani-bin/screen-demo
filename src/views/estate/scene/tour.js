/**
 * 自动导览：8 个停靠点，镜头逐段飞过去，配一句讲解词
 * ----------------------------------------------------------
 * 只做"编排"：每一步调场景的 flyToPlan / setLayer / tweenTime，再等一段时间。
 * 任何人为操作（拖动、点击、滑动时间条）都会停掉它；讲解词通过回调交给页面显示。
 * 停靠点名称与 docs/design/estate/05-requirement.md 一致。
 */
const wait = (ms, token) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(true), ms)
    token.cancel.push(() => {
      clearTimeout(t)
      resolve(false)
    })
  })

/**
 * 导览停靠点；讲解词里的数字都从布局派生
 * @returns {{name: string, text: string, dwell: number, run: (scene: object) => void}[]}
 */
export function tourStops(layout) {
  const t = layout.totals
  const k = t.byKind
  const A = (id) => layout.amenities.find((a) => a.id === id)
  // 某类住宅的层数范围文字（全部同层就写一个数，不同层写 "8–9"），讲解词里不再写死层数
  const floorsText = (kind) => {
    const f = layout.buildings
      .filter((b) => b.kind === kind)
      .map((b) => b.floors)
    const lo = Math.min(...f)
    const hi = Math.max(...f)
    return lo === hi ? `${lo}` : `${lo}–${hi}`
  }
  return [
    {
      name: "总览",
      text: `${layout.name}：${layout.slogan}。占地约 ${t.siteMu} 亩，${t.buildings} 栋住宅、${t.units} 户，北排高层、中部洋房、南排联排，围着中央景观湖。`,
      dwell: 6500,
      run: (s) => s.goHome(2.4)
    },
    {
      name: "区位交通",
      text: "北接锦澜大道，东邻地铁站 A 口，步行约 3 分钟；人车分流，车辆从北侧两个入口直接进入地下车库。",
      dwell: 7000,
      run: (s) => s.setLayer("traffic")
    },
    {
      name: "北排高层",
      text: `北排 ${k.tower.buildings} 栋高层，${layout.buildings
        .filter((b) => b.kind === "tower")
        .map((b) => b.floors)
        .join(
          " / "
        )} 层，坐北朝南，兼作北侧主路的屏障，阴影落在身后，不挡南边的洋房。`,
      dwell: 6500,
      run: (s) => {
        s.setLayer(null)
        s.flyToPlan(0, 70, {
          dist: 320,
          polar: 50,
          azimuth: -22,
          h: 40,
          duration: 2
        })
      }
    },
    {
      name: "景观轴与湖",
      text: `一条 24 米宽的景观轴，从主入口穿过跌水，直抵约 ${Math.round(((Math.PI / 4) * A("LK01").w * A("LK01").d) / 100) * 100} ㎡ 的中央景观湖，环湖步道约 250 米。`,
      dwell: 7000,
      run: (s) => s.setLayer("scenic")
    },
    {
      name: "洋房组团",
      text: `${k.terrace.buildings} 栋 ${floorsText("terrace")} 层洋房分列湖的东西两侧，每侧 4 栋，靠湖的 4 栋是湖景房，其余看中庭。`,
      dwell: 6500,
      run: (s) => {
        s.setLayer(null)
        s.flyToPlan(0, 15, {
          dist: 270,
          polar: 46,
          azimuth: 24,
          h: 8,
          duration: 2
        })
      }
    },
    {
      name: "滨河联排",
      text: `南排 ${k.villa.buildings} 栋 ${floorsText("villa")} 层联排临滨河路，共 ${k.villa.units} 户，对面是河岸公园和锦澜河。`,
      dwell: 6500,
      run: (s) =>
        s.flyToPlan(0, -78, {
          dist: 230,
          polar: 44,
          azimuth: -16,
          h: 4,
          duration: 2
        })
    },
    {
      name: "会所与配套",
      text: "社区会所带恒温泳池和健身房，室外泳池、儿童乐园、运动场分布在湖的南侧；东侧是底商街，西南角是社区幼儿园。",
      dwell: 7500,
      run: (s) => s.setLayer("club")
    },
    {
      name: "一天光影",
      text: "拖动底部的时间条，可以看一天里阳光和阴影怎么走；傍晚窗灯、路灯和泳池灯依次亮起。",
      dwell: 10500,
      run: (s, ctx) => {
        s.setLayer(null)
        s.flyToPlan(0, 5, { dist: 560, polar: 38, azimuth: 0, duration: 2 })
        // 从清晨走到夜晚，再回到起始时刻
        s.setTime(7)
        s.tweenTime(20.5, 7500, () => s.tweenTime(ctx.startHour, 1500))
      }
    }
  ]
}

/**
 * 导览播放器
 * @param scene EstateScene
 * @param onStop (index, stop) 每到一个停靠点回调；onEnd 导览结束 / 被打断
 */
export function createTour(scene, layout, { onStop, onEnd }) {
  const stops = tourStops(layout)
  let token = null
  let running = false

  async function loop(startHour) {
    const my = { cancel: [] }
    token = my
    running = true
    scene.touring = true
    const ctx = { startHour }
    let i = 0
    while (token === my) {
      const stop = stops[i % stops.length]
      onStop?.(i % stops.length, stop)
      stop.run(scene, ctx)
      const ok = await wait(stop.dwell, my)
      if (!ok || token !== my) break
      i++
    }
  }

  return {
    stops,
    get running() {
      return running
    },
    start() {
      if (running) return
      loop(scene.hour)
    },
    stop() {
      if (!running) return
      running = false
      scene.touring = false
      const my = token
      token = null
      my?.cancel.forEach((f) => f())
      scene._timeTween = null
      onEnd?.()
    }
  }
}
