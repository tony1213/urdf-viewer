#!/bin/bash
# ================================================================
#  URDF Robot Viewer — 一键部署到 GitHub Pages
#  用法: 在终端运行 bash setup-and-deploy.sh
# ================================================================

set -e

REPO_NAME="urdf-viewer"
GITHUB_USER="tony1213"

echo "============================================"
echo "  URDF Robot Viewer 部署脚本"
echo "============================================"
echo ""

# Step 1: 检查 gh CLI
if ! command -v gh &> /dev/null; then
    echo "❌ 需要安装 GitHub CLI (gh)"
    echo "   macOS:  brew install gh"
    echo "   Linux:  https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
    exit 1
fi

# Step 2: 检查登录状态
if ! gh auth status &> /dev/null; then
    echo "📝 请先登录 GitHub..."
    gh auth login
fi

echo "✅ GitHub CLI 已登录"

# Step 3: 在 GitHub 上创建仓库
echo ""
echo "📦 创建 GitHub 仓库: ${GITHUB_USER}/${REPO_NAME}"
gh repo create "${REPO_NAME}" --public --description "Web-based URDF Robot Viewer with Three.js" 2>/dev/null || echo "   (仓库可能已存在，继续...)"

# Step 4: 初始化 Git 并推送
echo ""
echo "🚀 推送代码..."
git init
git add .
git commit -m "feat: URDF Robot Viewer with Three.js

- Folder drag-and-drop loading (URDF + STL/OBJ/DAE meshes)
- Joint control with sliders
- RGB joint axis visualization
- Per-link opacity control
- COM and inertia visualization
- Coordinate system switching (±X/±Y/±Z)
- Auto-ground alignment
- Collapsible URDF tree + folder tree browser
- Resizable sidebar"

git branch -M main
git remote add origin "https://github.com/${GITHUB_USER}/${REPO_NAME}.git" 2>/dev/null || git remote set-url origin "https://github.com/${GITHUB_USER}/${REPO_NAME}.git"
git push -u origin main --force

# Step 5: 启用 GitHub Pages (via GitHub Actions)
echo ""
echo "⚙️  配置 GitHub Pages..."
# The deploy.yml workflow handles this automatically
# Just need to ensure Pages is enabled with Actions source
sleep 3

echo ""
echo "============================================"
echo "  ✅ 部署完成！"
echo "============================================"
echo ""
echo "  🔗 仓库地址:"
echo "     https://github.com/${GITHUB_USER}/${REPO_NAME}"
echo ""
echo "  🌐 网站地址 (等待 1-2 分钟自动构建):"
echo "     https://${GITHUB_USER}.github.io/${REPO_NAME}/"
echo ""
echo "  📋 后续操作:"
echo "     1. 打开仓库 Settings → Pages"
echo "     2. 确认 Source 选择 'GitHub Actions'"
echo "     3. 等待 Actions 构建完成即可访问"
echo ""
echo "  🔄 更新代码后重新部署:"
echo "     git add . && git commit -m 'update' && git push"
echo ""
