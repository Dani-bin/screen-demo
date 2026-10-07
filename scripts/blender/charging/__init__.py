"""
智慧充电站三维模型（Blender 构建脚本包）
----------------------------------------------------------
在 Blender（5.1+）里执行，见 build.py 的 run() 与 README 用法：

    import sys, importlib
    sys.path.insert(0, "<repo>/scripts/blender")
    import charging.build as b; importlib.reload(b); b.run()

模块：
- lib.py      几何与材质工具（bmesh 构造、贴图生成）
- palette.py  材质与程序化贴图
- assets.py   设备预制件（桩、车、雨棚、储能柜……）
- building.py 剖切服务楼
- layout.py   场站布局（坐标、编号）与摆放
- preview.py  预览渲染（正交等轴相机、辉光）
- export.py   导出 GLB
"""
