# URDF Robot Viewer

基于 Three.js 的 Web 端 URDF 机器人模型查看器。

**🌐 在线演示**: [https://tony1213.github.io/urdf-viewer/](https://tony1213.github.io/urdf-viewer/)

## 功能

- 📁 **文件夹拖拽加载** — 拖入包含 URDF + mesh 文件的完整文件夹
- 🔧 **Mesh 格式支持** — STL / OBJ / DAE (Collada)，DAE 自动降级为同名 STL
- 🎮 **关节控制** — 滑块实时控制 revolute / prismatic / continuous 关节
- 🔴🟢🔵 **关节坐标系** — RGB 三轴可视化，支持缩放
- 👁️ **逐 Link 透明度** — 每个 link 独立调整透明度
- ⚖️ **COM / 惯量可视化** — 质心标记 + 惯量椭球体
- 🌐 **坐标系切换** — 支持 ±X / ±Y / ±Z 六方向 Up Axis
- 📐 **自动落地** — 模型底部自动对齐地平面
- 🗂️ **双视图浏览器** — URDF 树 (可折叠) + 文件夹树
- ↔️ **可拖拽分栏** — 3D 视窗与侧边栏宽度自由调整

## 鼠标操作

| 操作 | 功能 |
|------|------|
| 左键拖拽 | 旋转视角 |
| 滚轮中键拖拽 | 平移视角 |
| 滚轮滚动 | 缩放 |

## 测试模型

推荐使用 [moveit/moveit_resources](https://github.com/moveit/moveit_resources) 中的机器人模型进行测试：

```bash
git clone https://github.com/moveit/moveit_resources.git
```

将以下文件夹拖入 Viewer 即可加载：
- `panda_description` — Franka Panda 7-DOF 协作臂
- `fanuc_description` — Fanuc M-10iA 6-DOF 工业臂
- `pr2_description` — PR2 移动操作平台

## 文件夹结构要求

```
your_robot/
├── urdf/
│   └── robot.urdf
├── meshes/
│   ├── visual/*.dae
│   └── collision/*.stl
```

URDF 中的 `package://` 路径会自动解析到文件夹内对应文件。

## 技术栈

- React 19 + Three.js
- Vite 8
- GitHub Pages + GitHub Actions

## License

MIT
