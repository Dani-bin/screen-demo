import {
  LineBasicMaterial,
  Mesh,
  Group,
  LineLoop,
  Vector3,
  BufferGeometry,
  CatmullRomCurve3,
  TubeGeometry
} from "three"
import { transfromMapGeoJSON } from "../utils/utils"
import { geoMercator } from "../utils/geo"

/**
 * 地图描边
 * type = "LineLoop"：普通线（宽度固定 1px）
 * type = "Line3"   ：CatmullRomCurve3 + TubeGeometry 做成细管，可贴图做流光
 */
export class Line {
  constructor(_, config = {}) {
    this.config = Object.assign(
      {
        visibelProvince: "",
        geoProjectionCenter: [0, 0],
        geoProjectionScale: 120,
        position: new Vector3(0, 0, 0),
        data: "",
        material: new LineBasicMaterial({ color: 0xffffff }),
        type: "LineLoop",
        renderOrder: 1,
        tubeRadius: 0.2
      },
      config
    )
    const mapData = transfromMapGeoJSON(this.config.data)
    this.lineGroup = this.create(mapData)
    this.lineGroup.position.copy(this.config.position)
  }
  geoProjection(args) {
    return geoMercator()
      .center(this.config.geoProjectionCenter)
      .scale(this.config.geoProjectionScale)
      .translate([0, 0])(args)
  }
  create(data) {
    const { type, visibelProvince } = this.config
    const features = data.features
    const lineGroup = new Group()
    for (let i = 0; i < features.length; i++) {
      const element = features[i]
      const group = new Group()
      group.name = "meshLineGroup" + i
      if (element.properties.name === visibelProvince) {
        continue
      }
      element.geometry.coordinates.forEach((coords) => {
        const points = []
        let line = null
        if (type === "Line3") {
          coords[0].forEach((item) => {
            const [x, y] = this.geoProjection(item)
            points.push(new Vector3(x, -y, 0))
          })
          line = this.createLine3(points)
        } else {
          coords[0].forEach((item) => {
            const [x, y] = this.geoProjection(item)
            points.push(new Vector3(x, -y, 0))
          })
          line = this.createLine(points)
        }
        group.add(line)
      })
      lineGroup.add(group)
    }
    return lineGroup
  }
  createLine3(points) {
    const tubeRadius = this.config.tubeRadius
    const tubeSegments = 256 * 10
    const tubeRadialSegments = 4
    const closed = false
    const { material, renderOrder } = this.config
    const curve = new CatmullRomCurve3(points)
    const tubeGeometry = new TubeGeometry(
      curve,
      tubeSegments,
      tubeRadius,
      tubeRadialSegments,
      closed
    )
    const line = new Mesh(tubeGeometry, material)
    line.name = "mapLine3"
    line.renderOrder = renderOrder
    return line
  }
  createLine(points) {
    const { material, renderOrder } = this.config
    const geometry = new BufferGeometry()
    geometry.setFromPoints(points)
    const line = new LineLoop(geometry, material)
    line.renderOrder = renderOrder
    line.name = "mapLine"
    return line
  }
  setParent(parent) {
    parent.add(this.lineGroup)
  }
}
