# Codex Plus 图标规范

此次只统一 Codex Plus 自有图标；宿主 Codex 的原生按钮、布局和交互沿用现状。

## 标识

以圆环与加号表示统一的增强入口。外环中心 (10,10)、半径 7.25；加号长度 6.5；两者线宽 1.4、圆角端点，使用 20×20 坐标。页面内贪吃蛇采用相同圆环和线宽，内部用一条连续 S 形路径区分动作。

## 三个使用位置

| 使用位置 | 形式与尺寸 | 颜色 |
| --- | --- | --- |
| App | 透明画布上的圆形底座，标识按0.78倍置中；ICNS包括16至1024像素 | 深墨绿#123B35、浅薄荷绿#BEF4DC |
| 菜单栏 | 18pt矢量PDF，作为NSImage模板 | 原稿黑色与透明，系统处理浅深色及选中状态 |
| Codex页面 | 20×20 SVG；点击区域36×36；原生悬停、焦点和间距 | currentColor，跟随相邻原生按钮 |

按钮名称保留“Codex Plus”和“贪吃蛇”；SVG隐藏于辅助技术，按钮提供名称。每个入口的可见位置、设置和行为不随图标变化。

## 窗口编号

0.9.1 起，页面的 Codex Plus 圆环中心以窗口编号代替加号；App 和菜单栏继续使用加号。页面沿用现有页脚圆形按钮的尺寸（随账号头像缩放）、颜色、焦点和设置动作。数字采用居中的系统字体、600字重，单数字为12.5/20比例，多数字缩小以留在圆环内。按钮名称仍为“Codex Plus”，悬停与辅助描述显示“窗口 N”。

## 资产生成

图标由 `scripts/render-icons.swift` 使用 AppKit/CoreGraphics 几何绘制，构建时生成完整 iconset、AppIcon.png 和 MenuBarIcon.pdf，再用 iconutil 生成 ICNS。缓存和输出保留在 `~/Library/Caches/codex-plus/`，`scripts/build` 复制资源后再签名；源代码不依赖设计工具、字体或远程图片。页面图形在 `Sources/CodexPlus/Resources/feature-entry.mjs` 中以同一坐标绘制；原生应用从 Bundle 读取 PDF 并标为模板。

## 核验

检查实际16/18/20像素、浅深色和透明边缘；安装后在Finder、菜单栏及Codex页核对真实显示并点击入口。使用Apple图标一致性和模板图像规范：

- https://developer.apple.com/design/human-interface-guidelines/icons
- https://developer.apple.com/documentation/appkit/nsimage/istemplate
