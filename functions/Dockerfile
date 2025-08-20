# 1. 使用官方的 Node.js 18 slim 版本作為基礎
FROM node:18-slim

# 2. 在容器內建立一個工作目錄
WORKDIR /usr/src/app

# 3. 複製 package.json 和 package-lock.json (如果有的話)
#    這樣可以利用 Docker 的快取機制，只有在依賴變更時才重新安裝
COPY package*.json ./

# 4. 安裝專案依賴
RUN npm install

# 5. 將所有程式碼複製到工作目錄中
COPY . .

# 6. 告訴 Docker 容器將會監聽 8080 連接埠
EXPOSE 8080

# 7. 設定容器啟動時要執行的預設指令
CMD [ "npm", "start" ]
