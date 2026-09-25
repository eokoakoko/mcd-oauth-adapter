从零部署麦当劳中国 MCP 的 ChatGPT OAuth 适配器（Render 版）

版本：2026-09-16 UPDATE：2026-9-25

适用：想让 ChatGPT 官端自定义 MCP / App 接入麦当劳中国官方 MCP 的用户

前置提醒：ChatGPT 账号需要能打开“开发者模式”和“自定义 MCP / App”入口。通常需要 Plus / Pro / Business / Enterprise / Education 等付费计划。
免费账号可能没有入口。若无，可看文末替代方案。

---

1. 原理：为什么需要一个 OAuth 适配器？

麦当劳中国官方 MCP：

```text
https://mcp.mcd.cn
```

它要求每次请求携带固定请求头：

```http
Authorization: Bearer <麦当劳 MCP Token>
```

但 ChatGPT 官端自定义 MCP 使用 OAuth，不能直接填固定上游 Bearer Token。

所以正确结构是：

```text
ChatGPT 官端
   ↓ OAuth 2.1 / PKCE / DCR / Streamable HTTP
你的 OAuth 适配器
   ↓ 出站时自动附加固定 Bearer Token
麦当劳官方 MCP
```

适配器只做三件事：

1. 对 ChatGPT 提供 OAuth 2.1 / PKCE S256、动态客户端注册 DCR、Streamable HTTP。
2. 验证 ChatGPT 拿到的 OAuth Access Token。
3. 把请求透明转发到麦当劳 MCP，并在出站请求里附加你的 MCD_MCP_TOKEN。

核心安全原则：

· 麦当劳 Token 只存在服务器环境变量里。
· 不要发给 ChatGPT、MCP Inspector、浏览器、聊天窗口或截图。
· 不要写进 GitHub 仓库。
· 适配器密码 ADAPTER_OWNER_PASSWORD 是你自己新设的密码，用来授权 ChatGPT 访问你的适配器。

---

2. 需要准备什么？

· 麦当劳中国官方 MCP Token
  申请地址：https://open.mcd.cn/mcp/doc
  
· 一个 GitHub 账号。

· 一个 Render 账号：https://render.com

· 一个 ChatGPT 账号，并且有“自定义 MCP / App”入口。

· 两个密码，务必分清：
  · MCD_MCP_TOKEN：麦当劳官方发给你的 Token。
  · ADAPTER_OWNER_PASSWORD：你自己新设的适配器授权密码。
  
· 桌面浏览器。OAuth 出问题时，Chrome / Edge 的 F12 Network 很有用。

---

3. 创建 GitHub 仓库

新建仓库，例如：

```text
mcd-oauth-adapter
```

4. 文件结构

- `src/server.js`：OAuth 适配器核心代码（含 Streamable HTTP 流式代理）
- `Dockerfile`：Render 部署所需的 Docker 构建文件
- `compose.yaml`：本地/服务器 Docker Compose 配置
- `.env.example`：环境变量示例模板（请勿填入真实密钥）
- `package.json`：项目依赖与启动脚本


---

最终文件结构：

```text
mcd-oauth-adapter/
├── src/
│   └── server.js
├── Dockerfile
├── package.json
├── compose.yaml
└── .env.example
```

---

5. 在 Render 部署

5.1. 打开 Render Dashboard，登录。
. 点击 New + → Web Service。
. 连接 GitHub，选择你的 mcd-oauth-adapter 仓库。
5.2. 配置：
   · Name：你的服务名，例如 mcd-oauth-adapter
   · Language：Docker
   · Region：Singapore
   · Branch：main
   · Plan：Free
！. 环境变量只填这三个：

```env
PUBLIC_BASE_URL=https://你的服务名.onrender.com
MCD_MCP_TOKEN=你的麦当劳Token
ADAPTER_OWNER_PASSWORD=你自己设置的长密码
```

PORT 可不填。Render 会自动注入。
其他 TTL 变量不填会使用代码默认值。
> ⚠️ 安全提示：`MCD_MCP_TOKEN` 和 `ADAPTER_OWNER_PASSWORD` 绝不能写进代码或提交到 GitHub。
```

. 点击 Create Web Service。
. 等待 2~3 分钟，看到绿色 Live 即部署成功。

---

6. 部署完成后的验证

把下面地址里的 你的服务名 换成你的 Render 服务名。

6.1 健康检查&接口验证

- 健康检查：`/healthz`
- OAuth Discovery：`/.well-known/oauth-authorization-server`
- 受保护资源元数据：`/.well-known/oauth-protected-resource/mcp`
- MCP 主入口：`/mcp`（需 OAuth 访问令牌）

正常返回：

```json
{
  "status": "ok",
  "service": "mcd-chatgpt-oauth-adapter",
  "oauth": "ready",
  "upstream": "not-contacted",
  "orderCreation": "blocked"
}
```

6.2 OAuth Discovery

```text
https://你的服务名.onrender.com/.well-known/oauth-authorization-server
```

应包含：

· issuer

· authorization_endpoint

· token_endpoint

· registration_endpoint

· code_challenge_methods_supported: ["S256"]

· authorization_response_iss_parameter_supported: true

6.3 Protected Resource Metadata

```text
https://你的服务名.onrender.com/.well-known/oauth-protected-resource/mcp
```

应返回：

· resource

· authorization_servers

· bearer_methods_supported

· scopes_supported

7.4 匿名访问 /mcp 应被拒绝

```text
https://你的服务名.onrender.com/mcp
```

应返回 401 Unauthorized。这说明公网端点没有被匿名访问。

---

7. 在 ChatGPT 官端创建自定义 MCP / App

不同版本页面名称可能变化。常见流程：

1. ChatGPT 网页端：设置 → 安全与登录 → 打开 Developer mode。
2. 进入插件 / Apps 页面。
3. 点击 +，创建开发者模式 App。
4. 填写：

字段 填写内容
名称 麦当劳点餐 / McDonald's
描述 麦当劳中国官方 MCP，可查询门店、菜单、优惠券、积分等
服务器 URL https://你的服务名.onrender.com/mcp
身份验证 OAuth
客户端注册 动态客户端注册 DCR
默认作用域 mcp
Client ID / Client Secret 使用 DCR 时留空

5. 点击创建。
6. ChatGPT 会走 OAuth，打开你自己的授权页。
7. 在授权页中只填写 ADAPTER_OWNER_PASSWORD。
8. 不要填麦当劳 MCD_MCP_TOKEN。
9. 授权成功后，刷新工具，先启用只读工具测试。

---

8. 正确 OAuth 流程

```text
ChatGPT 发起 OAuth
→ 打开 /authorize
→ 输入 ADAPTER_OWNER_PASSWORD
→ 适配器返回 Authorization Code
→ 浏览器跳回 ChatGPT
→ ChatGPT 请求 /token
→ 适配器签发短期 Access Token
→ ChatGPT 访问 /mcp
→ 适配器附加 MCD_MCP_TOKEN
→ 转发到麦当劳官方 MCP
```

---

9. 建议的测试顺序

1. 先用 /healthz 确认服务活着。
2. 再用 /.well-known/oauth-authorization-server 确认 OAuth 元数据。
3. 用 /.well-known/oauth-protected-resource/mcp 确认资源元数据。
4. 匿名访问 /mcp，确认返回 401。
5. 在 ChatGPT 里创建自定义 App。
6. 授权时输入 ADAPTER_OWNER_PASSWORD。
7. 先测试只读工具，例如 now-time-info。
8. 不要一上来就测试 create-order。

---

10. 常见故障排查

10.1 授权密码错误

现象：授权页提示密码不正确。
处理：确认填的是 ADAPTER_OWNER_PASSWORD，不是 MCD_MCP_TOKEN。

10.2 点击“允许”后没有跳转

检查浏览器 F12 → Network，看最新 authorize 请求的 Response Headers。
确认 Location 是否正确指向 ChatGPT。
检查授权页 CSP 是否允许 form-action 'self' https://chatgpt.com https://chat.openai.com。

10.3 /authorize 302 后没有 /token

检查 OAuth Discovery 是否包含：

```json
"authorization_response_iss_parameter_supported": true
```

并确认授权回调带了 iss 参数。

10.4 Render 日志怎么看

正常 OAuth 流程常见顺序：

```text
GET /authorize -> 200
POST /authorize -> 302 redirect=chatgpt.com/...
POST /token -> 200
POST /mcp -> 200
```

如果只停在 POST /authorize -> 302，没有 /token，问题通常发生在浏览器回调或 ChatGPT 接收回调阶段。

10.5 502 upstream_auth_failed

通常表示访问麦当劳 MCP 时上游 Token 无效或权限不足。
检查 Render 环境变量里的 MCD_MCP_TOKEN。不要把值发到聊天里。

10.6 429

麦当劳官方文档写明每个 Token 每分钟最多 600 次请求。不要高频轮询。

10.7 Render 第一次请求很慢

免费实例空闲后会休眠。重新访问 /healthz 唤醒，等服务恢复再继续 OAuth。

10.8 根路径返回 Cannot GET /

这是正常的。因为适配器只开放 /healthz、/authorize、/token、/register、/mcp 等路径，没有定义 /。请访问 /healthz。

---

11. 安全边界

· MCD_MCP_TOKEN 只存在于 Render 环境变量。

· ADAPTER_OWNER_PASSWORD 也只存在于 Render 环境变量。

· GitHub 仓库中不要提交 .env 或任何真实密钥。

· 不要在聊天、截图、日志或命令历史中暴露 Token 和密码。

· 这是单用户适配器：所有连接者实际使用的是同一个麦当劳 MCP 身份。

· 首次连接建议只做只读测试。

· 开启下单能力前，必须确认风险，并保留用户确认机制。

---

12. 免费替代方案：没有 ChatGPT Plus 怎么办？

如果你没有 ChatGPT Plus / Pro，无法打开开发者模式和自定义 MCP / App，可以考虑：

1. 使用支持自定义 MCP 的开源客户端：
   · 5ire
   
   · Open WebUI
   
   · Cherry Studio
   
3. 给这些客户端接入 LLM：
   · 云端 API：OpenAI、Anthropic、OpenRouter 等。
   
   · 本地模型：Ollama + 7B 左右小模型。
   
5. 使用桥接工具：
   · Chat2Agent 等，让 ChatGPT 网页版通过官方 MCP 连接器访问本地工作区。
   
7. 注意：
   · 第三方工具存在账号风险，建议先用小号测试。
   
   · 本流程主要针对有 ChatGPT 官端自定义 MCP 入口的用户。

---

13. 参考链接

· 麦当劳中国 MCP 官方平台：https://open.mcd.cn/mcp
· 麦当劳中国 MCP 官方文档：https://open.mcd.cn/mcp/doc
· 麦当劳 MCP Server：https://mcp.mcd.cn
· Render：https://render.com
