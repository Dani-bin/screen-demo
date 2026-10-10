// 材质销毁
const materialDispose = (material) => {
  if (material instanceof Array) {
    material.forEach(materialDispose)
  } else {
    if (material.map) {
      material.map.dispose()
    }
    material.dispose()
  }
}
// 递归释放几何体 / 材质 / 贴图
const deallocate = (obj) => {
  if (obj.geometry) {
    obj.geometry.dispose()
  }
  if (obj.material) {
    materialDispose(obj.material)
  }
  if (obj.texture) {
    obj.texture.dispose()
  }
  if (obj.children) {
    obj.children.forEach(deallocate)
  }
}
// 清空对象的全部子级并释放资源
const emptyObject = (obj) => {
  if (obj && obj.children)
    while (obj.children.length) {
      const childObj = obj.children[0]
      obj.remove(childObj)
      deallocate(childObj)
    }
}

export { emptyObject, deallocate }
