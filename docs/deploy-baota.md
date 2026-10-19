# 部署到自有服务器（宝塔面板）

推送到 master 后，GitHub Actions 自动构建，再通过 SSH（rsync）把 `dist/` 传到服务器上宝塔建的静态站点目录。
工作流是 `.github/workflows/deploy-server.yml`，服务器信息全部放在 GitHub Secrets，不进仓库。

```
git push master
  └─ GitHub Actions「部署到自有服务器」
       ├─ check   Secrets 都没配 → 整个跳过；配了一部分 → 报错列出缺哪几个
       ├─ build   yarn build（BASE_PATH 默认 /）→ 打包 dist      ← 这一步拿不到任何 Secrets
       └─ deploy  rsync over SSH → 服务器站点目录                ← 只有这一步用私钥
                                      └─ 宝塔 Nginx 直接当静态文件提供
```

和现有的 GitHub Pages 发布（`deploy-pages.yml`）**并存**：每次推送两边各自构建、各自发布，一边失败不影响另一边。
Pages 当公网展示地址，自己的服务器给国内客户演示用（Pages 在国内打开慢，70 MB 的模型尤其明显）。
以后不想要 Pages 了，在仓库 Actions 页面选中「部署到 GitHub Pages」→ 右上角 `···` → Disable workflow 即可。

## 为什么用 Actions 推送，而不是宝塔 WebHook

|                   | GitHub Actions 构建后推送（采用）                    | 宝塔 WebHook 插件触发服务器拉代码构建                                |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| 服务器要装        | 只要 rsync（多数系统自带）                           | git、Node 22、yarn，外加几百 MB 的 node_modules                      |
| 在哪构建          | GitHub 的免费机器                                    | 服务器自己，构建时吃 CPU / 内存，小机器可能卡住线上站点              |
| 服务器访问 GitHub | 不需要                                               | 每次都要 `git pull`；仓库打包后约 205 MB，国内服务器连 GitHub 常超时 |
| 安全面            | 只多一个只能写站点目录的用户，私钥在 GitHub Secrets  | 公网暴露一个能触发服务器执行脚本的 URL                               |
| 出错怎么看        | Actions 页面有完整日志，失败会发邮件                 | 只能登录宝塔看插件日志                                               |
| 前提              | 服务器 SSH 端口要对公网开放（GitHub 机器 IP 不固定） | 服务器能访问 GitHub                                                  |

如果 SSH 只允许固定 IP 登录、不能对公网开放，可以改用 GitHub 的 self-hosted runner（在服务器上装 runner，由它主动连 GitHub 取任务），需要的话再改工作流。

## 一、先决定两件事

1. **用什么地址访问**
   - **IP + 端口**（如 `http://1.2.3.4:8080`）：不用域名、不用备案，最省事。
   - **域名**（如 `demo.example.com`）：要把域名解析到服务器；**大陆服务器用域名走 80 / 443 端口必须先 ICP 备案**，否则会被云厂商拦截。
   - 页面没有用到必须 HTTPS 才能用的浏览器能力（语音播报、WebAudio、全屏在 http 下都能用），所以 IP + http 也能完整演示。
2. **挂在什么路径下**
   - **独立站点、根路径 `/`（推荐，也是工作流默认值）**：打开 `http://地址/` 就是首页。
   - **挂在已有站点的子目录**（如 `https://已有域名/bi/`）：需要额外设一个仓库变量 `DEPLOY_BASE_PATH=/bi/`，
     Nginx 片段里的路径也要跟着改（见第五步末尾）。

下文以「独立站点，站点目录 `/www/wwwroot/bi-demo`，部署用户 `deploy`」为例，换成自己的值即可。

## 二、宝塔面板：建站点

1. 网站 → PHP 项目 → **添加站点**：
   - 域名：填域名，或者 `服务器IP:8080` 这种 IP + 端口的写法（端口自己挑一个没被占用的）；
   - 根目录：改成 `/www/wwwroot/bi-demo`；
   - FTP、数据库：不创建；
   - PHP 版本：**纯静态**。
2. 用 IP + 端口访问时，要放行这个端口：宝塔「安全」→ 系统防火墙 → 添加端口规则；**云服务器控制台的安全组里也要放行**（两处都要）。
3. 不需要设置伪静态：页面是 hash 路由（地址形如 `/#/city`），服务器只会收到对 `/` 的请求，不需要把任意路径回退到 `index.html`。

此时访问站点会看到宝塔的默认页，说明站点通了。

## 三、本机：生成部署专用的密钥

在自己的 Mac 上执行（专门给 GitHub Actions 用的一把新钥匙，不要复用自己平时登录服务器的私钥）：

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions@bi-demo" -f ~/.ssh/bi_demo_deploy
```

得到两个文件：`~/.ssh/bi_demo_deploy`（私钥，稍后放进 GitHub Secrets）和 `~/.ssh/bi_demo_deploy.pub`（公钥，放到服务器）。
查看公钥内容：

```bash
cat ~/.ssh/bi_demo_deploy.pub
```

## 四、服务器：建部署用户、交出站点目录、装 rsync

在宝塔「终端」（root）里依次执行，第 2 条引号里换成上一步公钥的**整行**内容，开头的 `restrict ` 保留：

```bash
# 1. 建一个只用来上传文件的用户（不给 sudo）
useradd -m -s /bin/bash deploy

# 2. 放公钥；restrict 表示这把钥匙不能做端口转发、代理等，只能登录执行命令
mkdir -p /home/deploy/.ssh
echo 'restrict ssh-ed25519 AAAA…… github-actions@bi-demo' >> /home/deploy/.ssh/authorized_keys
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# 3. 站点目录交给 deploy 写；Nginx（宝塔里是 www 用户）只需要读，发布时会统一设成 目录 755 / 文件 644
#    如果提示 .user.ini 的 Operation not permitted，是宝塔给它加了防改锁，不影响，忽略即可
chown -R deploy:deploy /www/wwwroot/bi-demo

# 4. 装 rsync（多数系统已自带；CentOS / 阿里云系统用 yum，Ubuntu / Debian 用 apt-get）
command -v rsync || yum install -y rsync || apt-get install -y rsync
```

回到 Mac，试一下能不能用这把钥匙登录（`22` 换成自己的 SSH 端口，`服务器IP` 换成实际地址）：

```bash
ssh -i ~/.ssh/bi_demo_deploy -p 22 deploy@服务器IP 'rsync --version | head -n 1'
```

第一次连接会问是否信任服务器，输入 `yes`；最后打印出 `rsync  version 3.x` 就说明这一步全部通了。连不上见文末「常见问题」。

## 五、宝塔面板：Nginx 配置（压缩与缓存）

网站 → 找到站点 → 设置 → **配置文件**，把下面这段粘贴到 `server { … }` 里面（例如 `#REWRITE-END` 那一行的下面），保存。
宝塔会先检查语法，有错会提示并拒绝保存。宝塔默认的两段 `location ~ .*\.(gif|jpg|…)$`、`location ~ .*\.(js|css)?$` 可留可删，不冲突。

```nginx
    # ===== bi-demo 大屏：压缩与缓存 =====

    # 压缩：宝塔全局只压缩 js / css 等文本，这里补上 JSON、GLB 模型和字体
    # （实测多数 GLB 压完只剩原来的 35%–65%，城市数据 JSON 只剩约 30%；webp 本身已压缩，不再压）
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1k;
    gzip_vary on;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml model/gltf-binary font/ttf font/otf;

    # 入口页：每次打开都向服务器确认，发布后立刻生效
    location = /index.html {
        expires -1;
    }

    # 构建产物（JS / CSS / 字体）：文件名带内容哈希，内容一变名字就变，可以放心长期缓存
    location ^~ /assets/ {
        expires 1y;
        access_log off;
        # 宝塔自带的 mime.types 里没有 ttf / otf，补上类型才会被上面的 gzip 压缩
        location ~* \.(ttf|otf)$ {
            types { font/ttf ttf; font/otf otf; }
        }
    }

    # 三维模型：补上 GLB 的类型（同样是为了 gzip）
    # 模型、贴图、数据的文件名不带哈希，重新发布是同名覆盖，所以每次都向服务器确认；
    # 没变时服务器只回一个 304，不会重新下载
    location ~* \.glb$ {
        types { model/gltf-binary glb; }
        expires -1;
        access_log off;
    }
    location ~* \.(webp|json)$ {
        expires -1;
        access_log off;
    }
```

说明：

- `types { … }` 写在 location 里会**替换**这个 location 的整张类型表，所以只放在只命中 GLB / 字体的 location 里，不要挪到 server 一级。
- 缓存全用 `expires` 而不是 `add_header`：在 location 里写 `add_header` 会让 server 一级的 `add_header`（比如宝塔开启 HSTS 时加的）失效。
- **挂在子目录时**（`DEPLOY_BASE_PATH=/bi/`）：把 `location = /index.html` 改成 `location = /bi/index.html`，`location ^~ /assets/` 改成 `location ^~ /bi/assets/`，其余不变。

**可选：HTTPS**（需要已备案、已解析的域名）：站点设置 → SSL → Let's Encrypt → 申请，成功后打开「强制 HTTPS」。证书验证用的 `.well-known` 目录发布时不会被删。

## 六、GitHub：配置 Secrets

打开仓库 <https://github.com/Dani-bin/screen-demo> → Settings → Secrets and variables → Actions → Secrets 标签 → **New repository secret**，逐个添加：

| 名称                 | 必填 | 填什么                                                                                                   |
| -------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| `DEPLOY_HOST`        | 是   | 服务器 IP 或域名（SSH 连接用的地址）                                                                     |
| `DEPLOY_USER`        | 是   | `deploy`                                                                                                 |
| `DEPLOY_SSH_KEY`     | 是   | 私钥全文：在 Mac 上执行 `pbcopy < ~/.ssh/bi_demo_deploy` 后直接粘贴（包括 BEGIN / END 两行）             |
| `DEPLOY_PATH`        | 是   | 站点目录 `/www/wwwroot/bi-demo`（挂子目录时填到子目录，如 `/www/wwwroot/已有站点/bi`，并先建好这个目录） |
| `DEPLOY_PORT`        | 否   | SSH 端口，是 22 就不用填                                                                                 |
| `DEPLOY_KNOWN_HOSTS` | 建议 | 服务器的 SSH 公钥，用来识别中间人，获取方法见下                                                          |

只有挂在子目录时才需要：Variables 标签 → New repository variable → `DEPLOY_BASE_PATH` = `/bi/`（前后都带斜杠）。

**获取 `DEPLOY_KNOWN_HOSTS`**：不配也能发布（工作流会现场扫描并给出警告），但配上更安全。在 Mac 上：

```bash
ssh-keyscan -p 22 服务器IP 2>/dev/null | ssh-keygen -lf -
```

会打印几行 `SHA256:…` 指纹。再到宝塔终端执行下面这条，对照 ED25519 那一行的指纹是否一致：

```bash
for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done
```

一致后在 Mac 上复制扫描结果，粘贴为 `DEPLOY_KNOWN_HOSTS`：

```bash
ssh-keyscan -p 22 服务器IP 2>/dev/null | pbcopy
```

这里的 `服务器IP` 要和 `DEPLOY_HOST` 写法一致（都用 IP，或都用同一个域名），否则比对不上。

私钥放进 Secrets 后，Mac 上的 `~/.ssh/bi_demo_deploy` 可以留着以后手动排查用，注意别外传；不需要了就删掉。

## 七、首次发布与验证

1. 仓库 Actions → 左侧「部署到自有服务器」→ **Run workflow**（或者随便推送一次 master）。
   首次要传约 76 MB（rsync 压缩后实际约 52 MB），从 GitHub 的海外机器传到国内服务器可能要几分钟；以后只传有变化的文件。
   中途失败直接重跑即可：已经传完的文件会跳过，入口页最后才换，失败期间旧版本照常访问。
2. 打开站点地址，应该直接进演示首页；点进几个演示确认模型都能加载。
3. 在 Mac 上核对缓存和压缩是否生效（地址换成自己的）：

```bash
curl -sI http://服务器地址/ | grep -i cache-control
```

应为 `Cache-Control: no-cache`。

```bash
curl -sI -H 'Accept-Encoding: gzip' http://服务器地址/building/tower_S.glb | grep -iE 'content-type|content-encoding|cache-control'
```

应看到 `model/gltf-binary`、`gzip` 和 `no-cache`。

## 八、日常使用

- **发布**：推送到 master 即可，Pages 和自己的服务器同时更新。也可以在 Actions 页面手动 Run workflow 重新发布。
- **回滚**：在 Actions 里打开「部署到自有服务器」过去某次成功的运行 → Re-run all jobs，会按当时那个提交重新构建发布。下次推送又会发布最新代码。
- **暂停发布到服务器**：删掉 `DEPLOY_HOST` 等 Secrets（工作流会自动跳过），或在 Actions 页面 Disable 这个工作流。
- **旧文件**：发布时会删掉服务器上多余的文件，但 `assets/` 里的旧 JS / CSS 会保留 30 天才清理——大屏页面可能连开很多天，
  发布后它还会按需加载旧版本的分包，立刻删会导致切换页面时白屏。宝塔建站生成的 `.user.ini`、`.htaccess`、`404.html` 和 `.well-known` 不会被删。

## 常见问题

| 现象（Actions 日志里）                                       | 原因与处理                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Connection timed out` / `Connection refused`                | SSH 端口没对公网放行：检查云安全组、宝塔防火墙；宝塔「SSH 管理」或 fail2ban / 防爆破插件是否只允许固定 IP、或把 GitHub 的 IP 封了                                                                                                           |
| `Permission denied (publickey)`                              | ① `authorized_keys` 权限不对（目录 700、文件 600、属主 deploy）；② 私钥粘贴不完整；③ `/etc/ssh/sshd_config` 里有 `AllowUsers` 时要把 deploy 加进去；④ `/var/log/secure` 或 `auth.log` 提示 account is locked 时执行 `usermod -p '*' deploy` |
| `Host key verification failed`                               | `DEPLOY_KNOWN_HOSTS` 和 `DEPLOY_HOST` 写法不一致（IP 和域名混用、端口不是 22 却没用 `-p` 扫描），或服务器重装后公钥变了，按第六步重新获取                                                                                                   |
| `连不上服务器，或服务器上没有 rsync`                         | 看它上面 ssh 的报错；如果是 `command not found`，在服务器上装 rsync                                                                                                                                                                         |
| rsync 报 `Permission denied` / `failed to set permissions`   | 站点目录属主不是 deploy，重新执行第四步第 3 条 `chown`                                                                                                                                                                                      |
| `DEPLOY_PATH 指向的目录不存在，或既不是空目录也不是站点目录` | 防误删检查：目录必须已存在，且是空目录或里面有 `index.html`。确认 `DEPLOY_PATH` 填的是站点目录，挂子目录时先在服务器上建好空的子目录                                                                                                        |
| 页面白屏、控制台 404 找不到 `/assets/…`                      | 访问路径和构建时的 `BASE_PATH` 不一致：根路径访问时不要设 `DEPLOY_BASE_PATH`；挂子目录时变量、`DEPLOY_PATH`、Nginx 片段三处都要对应                                                                                                         |
| 发布成功但浏览器里还是旧页面                                 | 第五步的 Nginx 片段没加上或没保存成功（入口页被缓存了），用第七步的 `curl` 检查                                                                                                                                                             |
