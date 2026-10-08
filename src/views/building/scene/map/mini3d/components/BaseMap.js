import {
  Mesh,
  Vector2,
  Group,
  Object3D,
  MeshBasicMaterial,
  ShapeGeometry,
  Vector3
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { transfromMapGeoJSON, polygonToShape } from "../utils/utils"
import { geoMercator } from "../utils/geo"

/**
 * 平面地图：GeoJSON 多边形 → Shape → ShapeGeometry
 * merge=true 时把所有区块合并成一个 Mesh（用于不需要交互的底图）
 */
export class BaseMap {
  constructor(_, config = {}) {
    this.mapGroup = new Group()
    this.coordinates = []
    this.config = Object.assign(
      {
        position: new Vector3(0, 0, 0),
        geoProjectionCenter: new Vector2(0, 0),
        geoProjectionScale: 120,
        data: "",
        renderOrder: 1,
        merge: false,
        material: new MeshBasicMaterial({
          color: 0x18263b,
          transparent: true,
          opacity: 1
        })
      },
      config
    )
    this.mapGroup.position.copy(this.config.position)
    const mapData = transfromMapGeoJSON(this.config.data)
    this.create(mapData)
  }
  geoProjection(args) {
    return geoMercator()
      .center(this.config.geoProjectionCenter)
      .scale(this.config.geoProjectionScale)
      .translate([0, 0])(args)
  }
  create(mapData) {
    const { merge } = this.config
    const shapes = []
    mapData.features.forEach((feature) => {
      const group = new Object3D()
      const { name, center = [], centroid = [] } = feature.properties
      this.coordinates.push({ name, center, centroid })
      group.userData.name = name
      // MultiPolygon：每个多边形 = [外环, ...洞]，洞要挖掉，不能当成独立的面
      feature.geometry.coordinates.forEach((polygon) => {
        const shape = polygonToShape(polygon, (p) => this.geoProjection(p))
        if (!shape) return
        const geometry = new ShapeGeometry(shape)
        if (merge) {
          shapes.push(geometry)
        } else {
          const mesh = new Mesh(geometry, this.config.material)
          mesh.renderOrder = this.config.renderOrder
          mesh.userData.name = name
          group.add(mesh)
        }
      })
      if (!merge) {
        this.mapGroup.add(group)
      }
    })
    if (merge) {
      const geometry = mergeGeometries(shapes)
      const mesh = new Mesh(geometry, this.config.material)
      mesh.renderOrder = this.config.renderOrder
      this.mapGroup.add(mesh)
    }
  }
  getCoordinates() {
    return this.coordinates
  }
  setParent(parent) {
    parent.add(this.mapGroup)
  }
}
