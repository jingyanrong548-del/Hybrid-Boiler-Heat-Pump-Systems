// src/core/api.js
// 根据环境自动选择 API 地址
// 开发环境：使用本地后端 (http://localhost:8000)
// 生产环境：使用远程云服务

// 判断是否为开发环境：检查是否在 localhost 或 127.0.0.1 运行
const isDevelopment = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || 
     window.location.hostname === '127.0.0.1' ||
     import.meta.env.DEV);

const API_BASE = isDevelopment
    ? "http://localhost:8000"  // 开发环境：本地后端
    : "https://hybrid-boiler-heat-pump-systems.onrender.com";  // 生产环境：远程云服务

// 在控制台输出当前使用的 API 地址（方便调试）
if (isDevelopment) {
    console.log("🔧 开发模式：使用本地后端", API_BASE);
} else {
    console.log("🌐 生产模式：使用远程云服务", API_BASE);
}

/**
 * 呼叫 Python 后端执行 Scheme C (逆向平衡)
 */
export async function fetchSchemeC(payload) {
    try {
        console.log("📡 正在呼叫 Python 后端...", payload);
        console.log("📍 API 地址:", `${API_BASE}/calculate/scheme-c`);
        const response = await fetch(`${API_BASE}/calculate/scheme-c`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server Error: ${errText}`);
        }

        const data = await response.json();
        console.log("📥 后端返回数据:", data);
        return data;
    } catch (error) {
        console.error("API 通信失败:", error);
        throw error; // 抛出错误供 UI 捕获
    }
}