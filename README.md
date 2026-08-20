# dock-editor

[English](README.en.md)

dock 系列的文件编辑器插件：注册 `editor` 文件查看器（默认查看器）与对应的编辑器区视图，通过自己的 `/desk-editor` 主机路由读写文件文本内容。

## 功能

- **文本查看与编辑**：textarea 编辑，手动撤销/重做栈（Ctrl+Z / Ctrl+Y），Ctrl+S 保存。
- **未保存提示**：关闭带未保存修改的窗口前弹出确认（通过工作台 `beforeClose` 钩子与 seed dirty 标记）。
- **二进制检测**：读取时探测 NUL 字节，二进制文件显示提示而非乱码。
- **大小上限**：单文件读取上限 256 KiB；超过上限的文件只显示前 256 KiB、**禁用保存**，避免截断原文件（主机端同样校验并拒绝）。
- **悬浮窗几何记忆**：每个文件记住上次悬浮窗口的位置与大小，重新打开时恢复。

## 安装

需要 `dock` 与 `dock-files`：

```sh
dsh plugin add github:AKS1st/dock
dsh plugin add github:AKS1st/dock-files
dsh plugin add github:AKS1st/dock-editor
```

## 安全

`/desk-editor` 路由只接受受信任来源（回环地址 / trustedHosts + 同源检查）的 POST。所有读写路径先 realpath 规范化并限定在会话工作区内（越界 403）；写入前还会校验目标大小不超读取上限。

## License

MIT
