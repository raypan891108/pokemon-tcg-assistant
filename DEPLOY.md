# 部署到 Google Cloud 免費主機

把網站放到 Google Cloud 的 e2-micro 免費主機上，24 小時在線，用手機或任何電腦都能透過 `https://` 網址登入使用。

架構：

```
瀏覽器 ──HTTPS──▶ Caddy（自動申請憑證）──▶ Node 後端（API + 網頁）──▶ /opt/tcg/data（JSON 資料）
```

- 網站有**密碼登入**，沒登入看不到任何資料。
- 資料存在主機的 `/opt/tcg/data`，重新部署不會被清掉。
- 網址預設使用免費的 `sslip.io`（例如 `34-82-1-2.sslip.io`），不用買網域；之後也可以換成自己的網域。

---

## 1. 建立 Google Cloud 帳號（只需一次）

1. 到 <https://console.cloud.google.com/> 用 Google 帳號登入，建立一個專案（例如 `tcg-assistant`）。
2. 啟用帳單：免費方案也需要綁信用卡，但只要符合下面的條件就不會收費：
   - 機器類型 **e2-micro**，一台
   - 地區 **us-west1、us-central1 或 us-east1**（台灣、日本機房不在免費範圍）
   - 硬碟 **30 GB 標準永久磁碟**以內
3. **強烈建議設定預算提醒**：「帳單 → 預算與快訊」建立一個 US$1 的預算，一有費用就會收到 email。對外 IP 位址等項目可能產生少量費用，請以帳單頁面為準。

## 2. 在 Mac 安裝 gcloud 指令工具（只需一次）

```bash
brew install --cask google-cloud-sdk
```

```bash
gcloud init
```

依畫面指示登入 Google 帳號，並選擇剛剛建立的專案。

## 3. 建立主機（只需一次）

在 Mac 的終端機依序執行（`us-west1` 可換成另外兩個免費地區）：

保留固定 IP，主機重開後網址才不會變：

```bash
gcloud compute addresses create tcg-ip --region=us-west1
```

開放網頁用的 80、443 port：

```bash
gcloud compute firewall-rules create tcg-allow-web --allow=tcp:80,tcp:443 --target-tags=tcg-web
```

建立免費主機：

```bash
gcloud compute instances create tcg-assistant --zone=us-west1-b --machine-type=e2-micro --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=30GB --boot-disk-type=pd-standard --address=tcg-ip --tags=tcg-web
```

## 4. 設定主機（只需一次）

把設定腳本傳到主機：

```bash
gcloud compute scp deploy/setup-vm.sh tcg-assistant:~ --zone=us-west1-b
```

登入主機：

```bash
gcloud compute ssh tcg-assistant --zone=us-west1-b
```

在**主機上**執行（會安裝 Docker，並請你設定網址和登入密碼）：

```bash
sudo bash setup-vm.sh
```

- 網址直接按 Enter 會使用 `<IP>.sslip.io`。
- 登入密碼至少 8 個字元，請自己記好；密碼只存在主機的 `/opt/tcg/.env`。

完成後輸入 `exit` 離開主機。

## 5. 部署網站

在 Mac 的專案資料夾執行（只會部署**已 commit** 的程式碼）：

```bash
./deploy/deploy.sh
```

第一次會花幾分鐘建置。完成後開啟畫面上顯示的網址（`https://<DOMAIN>`），輸入密碼即可登入。

> 第一次開啟時 Caddy 需要約 1 分鐘申請 HTTPS 憑證，如果打不開請稍等再重新整理。

---

## 日常操作

### 更新網站
修改程式後先 commit，再執行：

```bash
./deploy/deploy.sh
```

主機名稱或地區不同時：`VM=名稱 ZONE=地區 ./deploy/deploy.sh`

### 查看後端 log

```bash
gcloud compute ssh tcg-assistant --zone=us-west1-b --command 'cd /opt/tcg/app/deploy && sudo docker compose --env-file /opt/tcg/.env logs --tail 100 app'
```

### 備份雲端資料到 Mac

```bash
gcloud compute ssh tcg-assistant --zone=us-west1-b --command 'sudo tar -czf - -C /opt/tcg data' > tcg-backup-$(date +%Y%m%d).tgz
```

倉庫紀錄只存在主機上，建議定期備份。

### 把 Mac 上的資料搬到雲端（選用）
本機和雲端的資料是分開的。如果要把本機的倉庫紀錄搬上去：

```bash
gcloud compute scp backend/data/inventory.json backend/data/watchlist.json tcg-assistant:~ --zone=us-west1-b
```

```bash
gcloud compute ssh tcg-assistant --zone=us-west1-b --command 'sudo mv ~/inventory.json ~/watchlist.json /opt/tcg/data/ && sudo chown 1000:1000 /opt/tcg/data/*.json && cd /opt/tcg/app/deploy && sudo docker compose --env-file /opt/tcg/.env restart app'
```

⚠️ 這會覆蓋雲端上的同名檔案。

### 修改登入密碼或網址
登入主機後編輯設定檔：

```bash
sudo nano /opt/tcg/.env
```

存檔後在主機上重新啟動：

```bash
cd /opt/tcg/app/deploy && sudo docker compose --env-file /opt/tcg/.env up -d
```

改了 `SESSION_SECRET` 會讓所有裝置登出。

---

## 注意事項

- **Discord Webhook 要在雲端網站的「設定」頁重新填一次**，雲端和本機的設定是分開的。
- **免費主機在美國**，部分網站可能會擋美國或雲端機房的 IP（例如日本官網的選手網站本來就有 Cloudflare 防護）。部署後請看 log 確認各爬蟲是否正常。
- e2-micro 只有 1 GB 記憶體，`setup-vm.sh` 已加上 2 GB swap 避免建置時記憶體不足。
- 想換成自己的網域：把網域的 A 紀錄指到主機 IP，再把 `/opt/tcg/.env` 的 `DOMAIN` 改成該網域並重新啟動。
