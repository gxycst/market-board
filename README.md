# 本地自选行情面板

Vue 3 + Vite + ECharts 前端，Node.js 后端统一代理行情源。默认每秒刷新一次，浏览器不会直接访问第三方行情接口。

当前包含：纳指期货、标普500期货、日经225、上证指数、深证成指、创业板指、三星电子、SK 海力士。

页面按中国、美国、日本、韩国四个分类显示。可在“添加 A 股”中输入六位股票代码；网页会自动识别沪市、深市或北交所，新增自选保存在当前浏览器中，也可用股票行右侧的 `×` 删除。

## Windows 启动

需先安装 Node.js 22（Node.js 20 也可）。在本目录打开 PowerShell：

```powershell
npm install
npm run dev
```

浏览器打开：<http://localhost:5173>

开发模式会同时启动：

- 网页：`http://localhost:5173`
- 行情代理：`http://localhost:3001`
- 行情接口：`http://localhost:3001/api/quotes`

停止服务：在 PowerShell 窗口按 `Ctrl + C`。

## 构建并以单端口运行

```powershell
npm run build
npm start
```

然后打开 <http://localhost:3001>。

## 绿联 NAS Docker 部署（SSD、避免影响机械硬盘休眠）

本项目不保存行情数据，也没有数据库。容器设置为只读，临时目录使用内存，Docker 日志最多保留两份、每份 5 MB。

先把整个项目目录复制到 NAS 的 SSD：

```text
/volume2/ssd_docker/market-board
```

SSH 登录 NAS 后执行：

```sh
cd /volume2/ssd_docker/market-board
docker compose up -d --build
docker compose ps
```

然后访问：

```text
http://NAS的局域网IP:3001
```

更新版本时覆盖项目文件，再执行：

```sh
cd /volume2/ssd_docker/market-board
docker compose up -d --build
```

如果项目是通过 Git 克隆的，也可以直接运行 `./update-market-board.sh`。NAS 不需要预先安装 Git：找不到 Git 命令时，脚本会自动使用 `alpine/git` Docker 镜像完成更新（首次运行可能需要下载该镜像）。项目目录仍需包含克隆时生成的 `.git` 目录。

脚本只会拉取当前分支所跟踪的上游仓库；运行前必须先将新提交推送到该远程分支。脚本会打印更新前后的提交，并强制使用新构建的镜像重建容器，便于确认实际运行的版本。

停止或启动：

```sh
docker compose stop
docker compose start
```

检查容器没有挂载机械硬盘路径：

```sh
docker inspect market-board --format '{{json .Mounts}}'
docker inspect market-board --format '{{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}'
```

第一条应显示 `[]`，第二条应显示 `local` 以及日志大小限制。项目目录、Docker Root Dir 和日志均位于 SSD 时，页面每秒刷新只产生网络与内存活动，不会持续读写机械硬盘。

## 行情源与数据说明

- 新浪财经：美股指数期货、日经指数、A 股指数（服务端批量请求）。
- Yahoo Finance chart：韩国三星电子和 SK 海力士。韩国市场独立为 provider，失败不会影响其余行情。
- 页面中的迷你分时图从网页打开后开始积累最近 90 个价格点。
- 非交易时间显示行情源返回的最后有效价格，不生成虚假实时价格。
- 这是公开接口适配的本地初版，第三方接口字段或访问策略变化时，只需修改 `server/src/providers/` 下对应 provider。

## ETF 溢价率预留接口

行情模型已预留 `iopv` 和 `premiumRate` 字段。可用 GET 或 POST 测试计算：

```text
GET /api/etf/premium?symbol=159941&price=1.678&iopv=1.520
```

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/etf/premium `
  -ContentType 'application/json' `
  -Body '{"symbol":"159941","price":1.678,"iopv":1.520}'
```

计算公式：`(实时价格 - IOPV) / IOPV × 100%`。当前只提供计算入口，后续接入可靠的盘中 IOPV 数据源后即可直接显示；不会用昨日 NAV 冒充盘中 IOPV。

## 目录结构

```text
client/                       Vue 3 / Vite / ECharts
server/src/providers/         行情 provider 抽象与实现
server/src/config/            自选品种配置
server/src/services/          聚合、缓存和容错
```
