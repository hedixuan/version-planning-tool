import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#5e6ad2",
          colorText: "#171a1f",
          colorTextSecondary: "#697180",
          colorBorder: "#e3e6eb",
          borderRadius: 8,
          fontSize: 13,
          controlHeight: 32,
        },
        components: {
          Card: { headerHeight: 46 },
          Layout: { bodyBg: "#f6f7f9", headerBg: "#ffffff", siderBg: "#fbfbfc" },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
