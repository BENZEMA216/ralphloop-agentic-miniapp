# Ralphloop 朋友端预览 HTTP API 实施计划

## 背景

当前产品化规格中已经定义朋友端最小 API：`GET /share/:token/preview`。代码里已有内部路由能力 `getFriendPreviewV1`，并有 route 层测试覆盖“朋友只能读取匹配分享链接与会话的预览帧”。缺口在于 HTTP Server 尚未暴露该能力，朋友网页也没有用当前会话刷新预览帧。

## 目标

补齐朋友端真实可用的只读预览入口：

1. HTTP Server 暴露 `GET /v1/share/:token/preview?sessionId=...`。
2. 朋友网页在提交任务后使用当前 `sessionId` 拉取预览帧。
3. 朋友端响应继续保持安全输出，不泄露成本、预算、token hash、ownerId 等创建者内部字段。

## 非目标

1. 不新增 Host 上传预览帧的 HTTP API，本次复用已有内部 `appendHostPreviewFrameV1` 做验证。
2. 不实现远程点击、键盘或交互控制；第一版仍以只读预览为默认安全形态。
3. 不调整 OAuth、计费、配额、沙箱隔离等更大产品能力。

## 实施步骤

1. 在 `apps/share-gateway/test/productization/httpServer.test.ts` 增加失败用例：
   - 创建 Host、分享链接和朋友会话。
   - 通过已有内部路由追加一帧预览。
   - 请求 `GET /v1/share/local-friend/preview?sessionId=...`，断言 200、返回帧、且无敏感字段。
   - 请求错误 session，断言 404 与 `preview_unavailable`。
   - 暂停分享链接后请求预览，断言 423 与 `share_link_paused`。
   - 静态朋友网页 HTML 断言包含 preview endpoint、`refreshPreview` 和预览渲染节点。
2. 在 `apps/share-gateway/src/productization/httpServer.ts`：
   - 引入 `getFriendPreviewV1`。
   - 增加 `GET /v1/share/:token/preview` 处理分支。
   - 在朋友网页脚本中增加 `previewEndpoint`、`previewFrame`、`refreshPreview`。
   - 任务提交完成后，在清空当前 session 前刷新预览。
3. 运行聚焦测试确认红绿闭环。
4. 运行全量验证命令，按项目规则确认任务完成状态。

## 验收标准

1. 朋友端可通过 HTTP 获取自己当前会话的预览帧。
2. 非匹配 token 或 session 不返回预览帧。
3. 暂停或失效的分享链接不能读取预览。
4. 朋友网页包含可执行的预览刷新逻辑，并渲染最新图片帧。
5. 所有相关响应不包含创建者成本、预算、token hash 或 ownerId 等内部字段。
6. 聚焦测试、全量测试、类型检查、构建、合同测试、集成测试、安全测试、E2E、真实适配器 smoke 和 diff 空白检查均通过。

## 必要测试用例

1. `httpServer.test.ts`：朋友端预览 HTTP API 成功返回帧。
2. `httpServer.test.ts`：错误 session 返回 `preview_unavailable`。
3. `httpServer.test.ts`：暂停分享链接后预览返回 `share_link_paused`。
4. `httpServer.test.ts`：朋友网页包含 `/v1/share/local-friend/preview`、`refreshPreview` 和图片预览渲染逻辑。
5. 全量验证命令覆盖现有 route、contract、integration、security、e2e 与 real-adapter smoke。
