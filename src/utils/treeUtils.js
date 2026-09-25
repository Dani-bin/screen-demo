/**
 * 树形数据工具函数
 * @Author: 
 * @Date: 2025-01-09
 * @Description: 提供树形数据组装、查找、遍历等工具函数
 */

/**
 * 根据id和parentId组装树形数据
 * @param {Array} flatData - 扁平数据数组
 * @param {Object} options - 配置选项
 * @param {string} options.idKey - id字段名，默认为'id'
 * @param {string} options.parentIdKey - parentId字段名，默认为'parentId'
 * @param {string} options.childrenKey - 子节点字段名，默认为'children'
 * @param {string|number|null} options.rootParentId - 根节点的parentId值，默认为null
 * @param {boolean} options.defaultExpand - 是否默认展开，默认为true
 * @param {Function} options.transform - 节点转换函数，可选
 * @returns {Array} 树形数据
 */
export const buildTreeData = (flatData, options = {}) => {
  const {
    idKey = 'id',
    parentIdKey = 'parentId',
    childrenKey = 'children',
    rootParentId = null,
    defaultExpand = true,
    transform = null
  } = options

  if (!Array.isArray(flatData) || flatData.length === 0) {
    return []
  }

  // 创建id到节点的映射
  const nodeMap = new Map()
  const result = []

  // 第一遍遍历：创建所有节点
  flatData.forEach(item => {
    let node = {
      ...item,
      [childrenKey]: []
    }

    // 设置默认展开状态
    if (defaultExpand) {
      node.isExpand = true
    }

    // 应用转换函数
    if (typeof transform === 'function') {
      node = transform(node, item)
    }

    nodeMap.set(item[idKey], node)
  })

  // 第二遍遍历：建立父子关系
  flatData.forEach(item => {
    const node = nodeMap.get(item[idKey])
    const parentId = item[parentIdKey]

    // 判断是否为根节点
    if (parentId === rootParentId || parentId === null || parentId === undefined || parentId === 0) {
      result.push(node)
    } else {
      // 查找父节点
      const parent = nodeMap.get(parentId)
      if (parent) {
        parent[childrenKey].push(node)
      } else {
        // 如果找不到父节点，可能是数据问题，将其作为根节点
        console.warn(`找不到父节点 parentId: ${parentId}, 将作为根节点处理`, item)
        result.push(node)
      }
    }
  })

  return result
}

/**
 * 扁平化树形数据
 * @param {Array} treeData - 树形数据
 * @param {string} childrenKey - 子节点字段名，默认为'children'
 * @returns {Array} 扁平数据
 */
export const flattenTreeData = (treeData, childrenKey = 'children') => {
  const result = []

  const traverse = (nodes) => {
    nodes.forEach(node => {
      const { [childrenKey]: children, ...rest } = node
      result.push(rest)

      if (children && children.length > 0) {
        traverse(children)
      }
    })
  }

  traverse(treeData)
  return result
}

/**
 * 查找树形数据中的节点
 * @param {Array} treeData - 树形数据
 * @param {Function} predicate - 查找条件函数
 * @param {string} childrenKey - 子节点字段名，默认为'children'
 * @returns {Object|null} 找到的节点或null
 */
export const findTreeNode = (treeData, predicate, childrenKey = 'children') => {
  for (const node of treeData) {
    if (predicate(node)) {
      return node
    }

    if (node[childrenKey] && node[childrenKey].length > 0) {
      const found = findTreeNode(node[childrenKey], predicate, childrenKey)
      if (found) {
        return found
      }
    }
  }

  return null
}

/**
 * 查找树形数据中所有匹配的节点
 * @param {Array} treeData - 树形数据
 * @param {Function} predicate - 查找条件函数
 * @param {string} childrenKey - 子节点字段名，默认为'children'
 * @returns {Array} 匹配的节点数组
 */
export const findAllTreeNodes = (treeData, predicate, childrenKey = 'children') => {
  const result = []

  const traverse = (nodes) => {
    nodes.forEach(node => {
      if (predicate(node)) {
        result.push(node)
      }

      if (node[childrenKey] && node[childrenKey].length > 0) {
        traverse(node[childrenKey])
      }
    })
  }

  traverse(treeData)
  return result
}

/**
 * 获取节点的所有父级路径
 * @param {Array} treeData - 树形数据
 * @param {string|number} targetId - 目标节点ID
 * @param {string} idKey - id字段名，默认为'id'
 * @param {string} childrenKey - 子节点字段名，默认为'children'
 * @returns {Array} 父级路径数组
 */
export const getNodePath = (treeData, targetId, idKey = 'id', childrenKey = 'children') => {
  const path = []

  const findPath = (nodes, currentPath = []) => {
    for (const node of nodes) {
      const newPath = [...currentPath, node]

      if (node[idKey] === targetId) {
        path.push(...newPath)
        return true
      }

      if (node[childrenKey] && node[childrenKey].length > 0) {
        if (findPath(node[childrenKey], newPath)) {
          return true
        }
      }
    }

    return false
  }

  findPath(treeData)
  return path
}

/**
 * 设置树形数据中所有节点的展开状态
 * @param {Array} treeData - 树形数据
 * @param {boolean} isExpand - 展开状态
 * @param {string} childrenKey - 子节点字段名，默认为'children'
 * @returns {Array} 更新后的树形数据
 */
export const setTreeExpand = (treeData, isExpand, childrenKey = 'children') => {
  return treeData.map(node => {
    const newNode = { ...node, isExpand }

    if (node[childrenKey] && node[childrenKey].length > 0) {
      newNode[childrenKey] = setTreeExpand(node[childrenKey], isExpand, childrenKey)
    }

    return newNode
  })
}

/**
 * 过滤树形数据
 * @param {Array} treeData - 树形数据
 * @param {Function} predicate - 过滤条件函数
 * @param {string} childrenKey - 子节点字段名，默认为'children'
 * @returns {Array} 过滤后的树形数据
 */
export const filterTreeData = (treeData, predicate, childrenKey = 'children') => {
  return treeData.filter(node => {
    const hasMatchingChildren = node[childrenKey] && node[childrenKey].length > 0
      ? filterTreeData(node[childrenKey], predicate, childrenKey).length > 0
      : false

    return predicate(node) || hasMatchingChildren
  }).map(node => {
    if (node[childrenKey] && node[childrenKey].length > 0) {
      return {
        ...node,
        [childrenKey]: filterTreeData(node[childrenKey], predicate, childrenKey)
      }
    }
    return node
  })
}

/**
 * 遍历树形数据
 * @param {Array} treeData - 树形数据
 * @param {Function} callback - 遍历回调函数
 * @param {string} childrenKey - 子节点字段名，默认为'children'
 * @param {number} level - 当前层级，默认为0
 */
export const traverseTree = (treeData, callback, childrenKey = 'children', level = 0) => {
  treeData.forEach(node => {
    callback(node, level)

    if (node[childrenKey] && node[childrenKey].length > 0) {
      traverseTree(node[childrenKey], callback, childrenKey, level + 1)
    }
  })
}

/**
 * 计算树形数据的最大深度
 * @param {Array} treeData - 树形数据
 * @param {string} childrenKey - 子节点字段名，默认为'children'
 * @returns {number} 最大深度
 */
export const getTreeMaxDepth = (treeData, childrenKey = 'children') => {
  if (!treeData || treeData.length === 0) {
    return 0
  }

  let maxDepth = 0

  treeData.forEach(node => {
    let depth = 1

    if (node[childrenKey] && node[childrenKey].length > 0) {
      depth += getTreeMaxDepth(node[childrenKey], childrenKey)
    }

    maxDepth = Math.max(maxDepth, depth)
  })

  return maxDepth
}

/**
 * 统计树形数据的节点数量
 * @param {Array} treeData - 树形数据
 * @param {string} childrenKey - 子节点字段名，默认为'children'
 * @returns {number} 节点总数
 */
export const getTreeNodeCount = (treeData, childrenKey = 'children') => {
  let count = 0

  const traverse = (nodes) => {
    nodes.forEach(node => {
      count++

      if (node[childrenKey] && node[childrenKey].length > 0) {
        traverse(node[childrenKey])
      }
    })
  }

  traverse(treeData)
  return count
}
