import {
  Mesh,
  Vector2,
  Vector3,
  Group,
  Object3D,
  ExtrudeGeometry,
  MeshBasicMaterial
} from "three"
import { transfromMapGeoJSON, polygonToShape } from "../utils/utils"
import { geoMercator } from "../utils/geo"

/**
 * 立体地图：GeoJSON 多边形 → Shape → ExtrudeGeometry（顶面 / 侧面两种材质）
 */
export class ExtrudeMap {
  constructor({ assets, time }, config = {}) {
    this.mapGroup = new Group()
    this.assets = assets
    this.time = time
    this.coordinates = []
    this.config = Object.assign(
      {
        position: new Vector3(0, 0, 0),
        geoProjectionCenter: new Vector2(0, 0),
        geoProjectionScale: 120,
        data: "",
        renderOrder: 1,
        topFaceMaterial: new MeshBasicMaterial({
          color: 0x18263b,
          transparent: true,
          opacity: 1
        }),
        sideMaterial: new MeshBasicMaterial({
          color: 0x07152b,
          transparent: true,
          opacity: 1
        }),
        depth: 0.1
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
    mapData.features.forEach((feature) => {
      const group = new Object3D()
      const { name, center = [], centroid = [] } = feature.properties
      this.coordinates.push({ name, center, centroid })
      const extrudeSettings = {
        depth: this.config.depth,
        bevelEnabled: true,
        bevelSegments: 1,
        bevelThickness: 0.1
      }
      const materials = [this.config.topFaceMaterial, this.config.sideMaterial]
      // MultiPolygon：每个多边形 = [外环, ...洞]，洞要挖掉，不能当成独立的块
      feature.geometry.coordinates.forEach((polygon) => {
        const shape = polygonToShape(polygon, (p) => this.geoProjection(p))
        if (!shape) return
        const geometry = new ExtrudeGeometry(shape, extrudeSettings)
        const mesh = new Mesh(geometry, materials)
        group.add(mesh)
      })
      this.mapGroup.add(group)
    })
  }
  getCoordinates() {
    return this.coordinates
  }
  setParent(parent) {
    parent.add(this.mapGroup)
  }
}
