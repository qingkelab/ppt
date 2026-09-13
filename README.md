# 青稞 PDF 资料库

这里用于收集、整理和分享青稞社区相关的 PDF 资料。

## 在线浏览

访问 [青稞 PDF 资料库](https://qingkelab.github.io/ppt/) 可以按分类筛选、搜索、在线预览和下载文档。

页面会自动读取仓库中 `pdf/` 等目录下的 PDF 文件，新上传的资料无需再次修改页面。

## 目录结构

```text
.
├── index.html
└── pdf/
    ├── meetup/
    │   ├── llm-infra/  # LLM Infra Meetup
    │   └── rl-infra/   # RL Infra Meetup
    └── */               # 其他 PDF 资料
```

## 添加 PDF

将 PDF 文件上传到 `pdf/` 或对应分类目录，页面会在下次刷新后自动显示。

建议文件名使用清晰的英文或中文标题，避免特殊字符和多余空格。

## 外部资料

无需复制文件到本仓库。可以在 `index.html` 的 `externalDocuments` 中登记原始 PDF 地址，页面会通过 PDF.js 提供在线预览。
