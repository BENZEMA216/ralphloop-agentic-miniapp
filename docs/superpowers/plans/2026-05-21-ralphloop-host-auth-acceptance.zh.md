# Ralphloop Host 认证与心跳鉴权验收文档

## 推荐继续任务

下一步建议做：**Host 认证与心跳鉴权**。

原因：

1. 产品化 spec 明确要求：Host 认证必须使用设备密钥或短期证书。
2. 当前 `POST /v1/hosts/register` 和 `POST /v1/hosts/:hostId/heartbeat` 仍是裸请求。
3. Host 是创建者真实 Agent 能力与本机运行时的入口；如果 Host 注册和心跳没有鉴权，后续的出站 Relay、任务路由、预览流都会建立在不可信 Host 身份上。
4. 这个任务范围清晰，可以用测试闭环验收，不需要先做完整登录、OAuth 或云端 Relay。

## 目标

给产品化 Host API 增加最小可验证的 Host 认证边界：

- Host 注册必须带有效的 bootstrap secret。
- Host 注册成功后获得或绑定一个设备密钥摘要。
- Host heartbeat 必须带有效设备密钥。
- 错误密钥、缺失密钥、跨 Host 使用密钥都必须被拒绝。
- 审计日志记录认证成功与失败，但不得保存明文密钥。

## 非目标

本任务不做：

- 完整创建者登录系统。
- 云端证书签发系统。
- mTLS。
- Host 出站长连接。
- 设备密钥轮换 UI。
- 朋友 OAuth 或使用者身份授权。

这些可以在后续任务继续拆分。

## 建议实现范围

### 数据模型

Host record 增加：

- `deviceKeyHash`
- `registeredAt` 或复用现有 `lastSeenAt`

禁止保存：

- 明文设备密钥。
- bootstrap secret。

### HTTP API

`POST /v1/hosts/register`

必须要求：

- `x-ralphloop-bootstrap-secret` header 或等效字段。
- 注册成功时生成或接收一次性 device key。

建议响应：

```json
{
  "host": {
    "id": "host-1",
    "status": "online",
    "supportedAdapters": ["opencode"]
  },
  "deviceKey": "returned-once"
}
```

`POST /v1/hosts/:hostId/heartbeat`

必须要求：

- `x-ralphloop-device-key` header。
- key 必须匹配该 Host 的 `deviceKeyHash`。

## 验收标准

### AC-001 注册必须鉴权

给定 Relay 配置了 bootstrap secret；

当 Host 注册请求缺少 bootstrap secret；

则返回 `401`，body 为：

```json
{ "error": "host_auth_required" }
```

并且不创建 Host。

### AC-002 注册成功只返回一次设备密钥

给定 Host 使用正确 bootstrap secret 注册；

当注册成功；

则返回 `201`，包含公共 Host 信息和 `deviceKey`；

并且持久化数据只保存 `deviceKeyHash`，不得保存明文 `deviceKey`。

### AC-003 heartbeat 必须带设备密钥

给定 Host 已注册；

当 heartbeat 缺少 `x-ralphloop-device-key`；

则返回 `401`：

```json
{ "error": "host_auth_required" }
```

Host 的 `lastSeenAt` 不应被更新。

### AC-004 heartbeat 密钥错误必须拒绝

给定 Host 已注册；

当 heartbeat 使用错误 device key；

则返回 `403`：

```json
{ "error": "host_auth_invalid" }
```

并且审计日志记录 `host.auth_failed`，但不得包含明文 key。

### AC-005 设备密钥不能跨 Host 使用

给定 `host-1` 和 `host-2` 分别注册；

当 `host-2` heartbeat 使用 `host-1` 的 device key；

则返回 `403`；

并且 `host-2` 不得被标记为 online heartbeat 成功。

### AC-006 Owner/Friend 响应不泄露认证材料

当调用：

- `GET /v1/owner/hosts`
- `GET /v1/owner/adapters`
- `GET /v1/share/:token`
- `GET /v1/owner/audit-logs`

则响应不得包含：

- `deviceKey`
- `deviceKeyHash`
- `bootstrapSecret`
- 明文 auth header

### AC-007 兼容本地开发

本地 `npm run dev:productized` 仍可启动。

开发模式可以使用默认本地 bootstrap secret，但必须只用于 local demo，并在代码或文档中标记为本地开发默认值。

## 必要测试

至少新增以下测试：

1. `security.test.ts`
   - Host 注册缺失 bootstrap secret 被拒绝。
   - Host 注册成功后持久化文件不保存明文 device key。
   - Owner/Friend API 不泄露 device key 或 hash。

2. `routes.test.ts`
   - 注册成功返回公共 Host 与一次性 device key。
   - heartbeat 缺失 key 返回 `401`。
   - heartbeat 错误 key 返回 `403`。
   - 跨 Host key 不能复用。

3. `httpServer.test.ts`
   - HTTP 注册和 heartbeat header 合同。
   - 错误认证响应不泄露内部细节。

4. 全量验证：

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:contract
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:smoke:real-adapter
git diff --check
```

## 完成条件

只有同时满足以下条件，才能声明任务完成：

1. 所有 Host 注册和 heartbeat 都经过认证。
2. 所有认证失败路径都有测试覆盖。
3. 明文密钥不落盘、不进入 audit log、不进入 Owner/Friend 响应。
4. 旧有分享链路、任务提交、审批、预览、限流测试全部继续通过。
5. 最新验证命令输出显示 0 fail。
