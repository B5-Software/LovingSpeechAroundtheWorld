# Loving Speech Around the World

让爱遍布于世界角落 —— 一个使用 Node.js + Tor 的分布式情书区块存储实验，包含 **Directory 权威服务器、Relay 中继服务器、Client 客户端** 三种模式，并同时提供 WebUI 与 CLI 两套交互界面。

## 功能亮点

- 🔐 客户端本地生成 RSA 密钥，使用混合加密写入情书区块。
- 🧱 Relay 维护区块链式存储并向 Directory 汇报完整性、延迟、可达性等指标。
- 🧭 Directory 根据各 Relay 的最新链摘要智能推荐最优节点，并提示需要补全或同步的中继。
- 🧅 三种模式均可配置 Tor 连接：自定义 torrc、网桥、进度与日志实时查看。
- 💻 所有 WebUI 功能均有 CLI 等价命令；核心库具备单元测试覆盖。

## 目录结构

```text
├─ cli/                    # Commander CLI 入口
├─ data/                   # 运行期数据（按模式隔离）
├─ modes/
│  ├─ directory/           # 权威目录服务
│  ├─ relay/               # 中继节点
│  └─ client/              # 客户端
├─ src/lib/                # 共享库：加密、区块链、Tor、同步等
├─ web/                    # 轻量 Web 界面（原生 JS + CSS）
└─ tests/                  # node:test 单元测试
```

## 快速开始

```pwsh
cd d:/Node-Projects/LovingSpeechAroundtheWorld
npm install
npm run build:assets
```

### 启动各模式的 WebUI

```pwsh
npm run directory:web   # 默认 http://localhost:4600
npm run relay:web       # 默认 http://localhost:4700
npm run client:web      # 默认 http://localhost:4800
```

### 使用 CLI

```pwsh
node cli/index.js directory serve --port 4600
node cli/index.js directory relays:list
node cli/index.js relay report
node cli/index.js client keys:create --label "MyKey"
```

完整命令可通过 `node cli/index.js --help` 查看，每个 WebUI 面板（配置、Tor、同步等）均有对应子命令，例如 `relay config:set --directory http://localhost:4600 --latency 80`、`client tor:config --path tor.exe` 等。

## Tor 配置

每个模式在 WebUI 的 “Tor 连接” 面板或 CLI (`<mode> tor:*`) 中可：

1. 编辑 torrc（可填网桥、入口/出口节点、端口等，运行时写入 `.tor-tmp/`）。
2. 启动 / 停止 Tor，并实时查看 Bootstrapped 进度与日志。
3. 默认不会触碰系统 Torrc，完全隔离。

## 区块 & 同步工作流

1. Relay 通过 `/api/letters` 接收客户端加密后的情书，立即加入本地区块链并生成新区块。
2. Relay 定期或手工调用 `/api/report` 向 Directory 发送链摘要（长度、哈希列表、校验值）及健康度。
3. Directory 维护各 Relay 的 `syncStatus`，当发现缺块或落后时在 WebUI 与 API 中标记提醒。
4. Client 通过目录挑选最优 Relay，同步区块后可本地解密属于自己的情书。

## 测试

```pwsh
npm test
```

覆盖 `src/lib` 核心模块：

- `crypto` 加密/解密及指纹
- `blockchain` 区块追加与校验
- `relaySelector` 智能选路

## 数据重置

清空 `data/<mode>` 即可让对应模式回到初始状态（自动重新生成 genesis block 与配置）。

## 下一步可扩展点

1. 把区块同步和指标上报做成后台定时任务（目前提供手动和可调用 API）。
2. 引入真正的 onion 服务托管（当前示例使用 HTTP URL 字段以便本地演示）。
3. 加入多收信人加密策略、附件支持或多语言 UI。

祝你用爱点亮每一个角落 💌
