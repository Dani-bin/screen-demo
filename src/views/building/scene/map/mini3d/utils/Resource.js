import { Loader, LoadingManager, TextureLoader } from "three"
import { EventEmitter } from "./EventEmitter"

const ResourceType = {
  TextureLoader: "Texture",
  FileLoader: "File",
  FontLoader: "Font",
  ImageLoader: "Image",
  ObjectLoader: "Object",
  MaterialLoader: "Material",
  CubeTextureLoader: "CubeTexture"
}
const types = Object.values(ResourceType)

/**
 * 资源统一加载器：并行加载全部资源，抛出 onProgress / onLoad / onError
 */
export class Resource extends EventEmitter {
  constructor() {
    super()
    this.itemsLoaded = 0
    this.itemsTotal = 0
    this.assets = []
    this.loaders = {}
    this.manager = this.initManager()
    this.addLoader(TextureLoader, "TextureLoader")
  }
  initManager() {
    const manager = new LoadingManager()
    manager.onError = (err) => {
      this.emit("onError", err)
    }
    return manager
  }
  addLoader(loader, loaderName = "") {
    if (loader && ResourceType[loaderName]) {
      const type = ResourceType[loaderName]
      if (!this.loaders[type]) {
        const instance = new loader(this.manager)
        if (instance instanceof Loader) {
          this.loaders[type] = instance
        }
      }
    } else {
      throw new Error("请配置正确的加载器")
    }
  }
  loadItem(item) {
    return new Promise((resolve, reject) => {
      if (!this.loaders[item.type]) {
        reject(new Error(`资源${item.path}没有配置加载器`))
        return
      }
      this.loaders[item.type].load(
        item.path,
        (data) => {
          this.itemsLoaded++
          this.emit("onProgress", item.path, this.itemsLoaded, this.itemsTotal)
          resolve({ ...item, data })
        },
        null,
        (err) => {
          this.emit("onError", err)
          reject(err)
        }
      )
    })
  }
  loadAll(assets) {
    this.itemsLoaded = 0
    this.itemsTotal = 0
    return new Promise((resolve, reject) => {
      const currentAssets = this.matchType(assets)
      this.itemsTotal = currentAssets.length
      Promise.all(currentAssets.map((item) => this.loadItem(item)))
        .then((res) => {
          this.assets = res
          this.emit("onLoad")
          resolve(res)
        })
        .catch((err) => {
          this.emit("onError", err)
          reject(err)
        })
    })
  }
  matchType(assets) {
    this.assets = assets.map((item) => {
      if (!types.includes(item.type)) {
        throw new Error(`资源${item.path},type不正确`)
      }
      return { type: item.type, path: item.path, name: item.name, data: null }
    })
    return this.assets
  }
  getResource(name) {
    const current = this.assets.find((item) => item.name === name)
    if (!current) {
      throw new Error(`资源${name}不存在`)
    }
    return current.data
  }
  destroy() {
    this.off("onProgress")
    this.off("onLoad")
    this.off("onError")
    this.assets = []
  }
}
