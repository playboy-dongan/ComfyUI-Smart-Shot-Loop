# ComfyUI 智能分镜循环 v0.2

**一个节点，填写分镜 → 接好两路提示词 → 一键生成全部视频。**

输入五组「图像提示词 + 视频提示词」，自动顺序生成五段：第一段结束后继续四次。五段各自保留在节点内的画廊，全部成功后只响一次。输入三组就生成三段，最多 100 组；不会自动拼接为一个视频。

## 通过 ComfyUI-Manager 安装

在支持该入口的 ComfyUI-Manager 中：

1. 打开 **Manager → Install via Git URL**（部分版本译作「通过 Git URL 安装」）
2. 粘贴 `https://github.com/playboy-dongan/ComfyUI-Smart-Shot-Loop`，点击安装
3. 重启 ComfyUI，再刷新浏览器；搜索「智能循环」添加节点

该方式直接从 GitHub 安装，但入口是否可用取决于 Manager 版本与管理员安全策略。当前官方 Manager 默认关闭任意 Git URL 安装，且会拒绝非 loopback/远端来源；AutoDL 这类云端网页不保证能用此入口。**尚未注册到 Comfy Registry，不承诺在节点市场搜索列表中能搜到。** 如果 Manager 因安全配置不允许 Git URL 安装，请使用你有权限的服务器安装方式；不要为了安装而关闭安全限制。可由有权限的用户/管理员在服务器终端把仓库 clone 到 custom_nodes，再重启 ComfyUI。详见 [Manager 官方安装限制](https://github.com/Comfy-Org/ComfyUI-Manager#dedicated-install-flags-allow_git_url_install--allow_pip_install)。

管理员允许手动安装时，可在 ComfyUI 的 custom_nodes 目录执行：

```bash
git clone https://github.com/playboy-dongan/ComfyUI-Smart-Shot-Loop.git
```

## 手动安装一次

将本目录放入 `ComfyUI/custom_nodes/comfyui-shot-loop/`，重启 ComfyUI 并刷新网页。无需额外 pip/npm 安装。

AutoDL 请放到**云端正在运行的 ComfyUI**目录。浏览器需使用 HTTPS 地址或 localhost，以支持跨标签页防重复锁。

## 日常只需三步

1. 节点搜索「智能循环」，添加 **智能循环 · 一键分镜视频**
2. 将 `image_prompt` 接原有生成图片的提示词，将 `video_prompt` 接原有图生视频的提示词
3. 在节点内下拉选择原有的最终视频保存节点，点击 **一键生成全部 N 段**

原来的图片生成、图生视频和保存视频链路保留。如果只有一个标准 SaveVideo / SaveWEBM / VHS Video Combine，打开下拉框时会自动选中。无需手填提示词源节点 ID。

推荐再把 `filename_prefix` 接最终保存节点的文件名前缀，确保每轮独立保存；原保存节点自动编号也可以。如果原提示词是文本框，右键原节点将相应 widget 转为 input 后接线。

把智能节点放在工作流末端附近即可一处查看所有视频。它的两个提示词输出同时接到原链路，画廊通过保存节点的执行历史收集视频，不需要回接视频形成图循环。

**普通 ComfyUI Queue/Run 仍然执行一次。批量生成请点击本节点内的一键按钮，不需要先生成第一段。**

## 示例组件文件

`智能循环组件.json` 只有一个智能节点，便于另开工作流查看或保存为节点模板，不包含模型。

标准 ComfyUI 拖入 JSON 通常会打开工作流，**不会自动合并到现有画布**。建议直接在原工作流搜索添加节点，或另开示例后复制该节点、粘贴到原工作流。

JSON 不能安装 Python 插件，必须先安装本目录。`分镜循环组件.json` 是保留的 v0.1 双节点示例；旧工作流仍可用。

## 输入格式

`shots_json` 使用 JSON 数组。每一项的 `image` 和 `video` 必填；`title` 可选，会显示在该段视频上方。

```json
[
  {"title":"海边开场", "image":"清晨，女孩站在海边，远景", "video":"镜头缓慢推进，海浪轻拍岸边"},
  {"title":"人物特写", "image":"女孩的侧脸特写，海风吹起头发", "video":"轻微环绕镜头，头发自然飘动"},
  {"title":"沿岸行走", "image":"女孩沿沙滩行走，全身中景", "video":"摄影机侧向跟随，脚步平稳"},
  {"title":"贝壳细节", "image":"沙滩上一枚贝壳，微距", "video":"镜头轻微下移，浪花掠过贝壳"},
  {"title":"落日收尾", "image":"女孩面向夕阳，背影远景", "video":"镜头缓慢拉远，夕阳反射海面"}
]
```

## 可自定义选项

- **数量**：随分镜数组长度自动变化，1–100 段，不用再填循环次数
- **标题**：每段可选 `title`，不参与生成提示词
- **sound_enabled**：完成提示音开关，默认开
- **sound_volume**：提示音音量，0–1，默认 0.12
- **delay_seconds**：两段之间等待时间，默认 0 秒；等待中可停止
- **timeout_minutes**：每段最大等待时长，默认 120 分钟
- **video_output_node_id**：目标保存节点。通常用下拉框即可，高级用户也可填 ID
- **shot_index / run_token**：内部调度字段。批量运行会自动设置，不用手动修改

高级选项在支持 advanced widgets 的前端中折叠展示；旧版前端可能显示全部字段。

工作流与模型参数在开始时固定快照，途中编辑不会改变后续分镜。模型种子沿用开始时的值，不擅自随机或递增；原生 before/afterQueued 回调可能修改画布上的可见种子，但批次执行仍使用快照值。

## 支持的保存节点

- ComfyUI SaveVideo / SaveWEBM 的本地视频文件输出
- VHS Video Combine 的 gifs 视频文件描述符
- 使用相同 `videos` / `gifs` / `images` 文件描述符结构的其他保存节点

每次必须输出恰好一个视频。推荐 MP4/H.264 或 WebM，浏览器播放能力取决于编码。若 API 节点只返回云端 URL，先接该节点配套的下载/本地保存节点。本组件不猜测供应商 API 字段、不替换模型，也不包含任何密钥。

VHS 请启用保存输出；临时目录文件可能被 ComfyUI 清理。

## 停止、恢复与并发

- 浏览器必须保持开启、电脑不要休眠；页面关闭/刷新不会继续提交下一段，已经提交的当前任务仍可能完成
- 开始前关闭自动队列、等原有队列清空。批次内不要从别处提交任务
- 防止本页面重复点击；Web Locks 防止同源同浏览器的另一个分镜标签页同时启动。无法锁住其他人的浏览器或第三方客户端
- 提交前发现其他排队任务就停止；其他客户端恰好在检查后提交的竞态仍可能存在，但视频只按本批次 prompt_id 汇总
- **停止后续分镜**不全局打断当前任务。要立即中止当前生成，请使用 ComfyUI 自带队列取消；云端 API 任务可能已计费或无法取消
- 出错、取消、断线、超时、视频不明或路径重复时停止后续提交，不播放成功提示音
- 提交响应不确定时绝不自动重试，避免重复计费；再次启动前先检查队列和历史
- 每次新批次清空旧画廊；原视频文件保留在服务器
- 完成后保存工作流，即保存各段标题与相对文件描述符。重新打开可恢复画廊，视频文件须仍存在；不自动恢复生成任务

当前版针对普通画布节点，不支持嵌套子图 ID。只提交选定视频输出及其上游，避免执行无关输出分支。第三方节点自己的缓存、文件覆盖行为或定制提交扩展仍需现场验证。

## 声音与认证

组件在 ComfyUI 页面发出一次短提示音，仅所有分镜成功并收集到视频后触发。其他扩展若有逐次完成提示音，请自行关闭。浏览器/系统静音仍会影响发声。

提交沿用 ComfyUI 原生 `app.queuePrompt` 和当前登录态/账户校验，不提取、存储或要求新凭据。每次提交期间短暂代理序列化与结果捕获，结束后恢复。修改提交函数的其他扩展可能需要兼容检查。

## 验证范围

26 项 JavaScript 测试、4 项 Python 测试与 JavaScript 语法检查通过。覆盖五次顺序执行、一次声音、分镜数量、提示词选择、独立画廊、保存恢复、取消/失败/超时、重复启动、预检竞态、原生认证转发、代理恢复、声音开关和段间等待。

前端测试加载真实扩展源码并模拟 DOM/Comfy API。**尚未在真实 ComfyUI、AutoDL、GPU、付费视频 API 或浏览器视频播放环境完成实测**；本版不声称已经验证所有第三方节点兼容性。

运行测试：

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

## 接口依据

2026-10-02 检查的官方项目：

- https://docs.comfy.org/custom-nodes/js/javascript_hooks
- https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/scripts/app.ts
- https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/scripts/api.ts
- https://github.com/Comfy-Org/ComfyUI/blob/master/server.py
- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_video.py
- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api/latest/_ui.py
- https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite/blob/main/videohelpersuite/nodes.py

## 许可

本仓库原创代码按 MIT License 发布。上面的官方源码链接仅用于核对接口，不包含复制的第三方实现或模型文件。
