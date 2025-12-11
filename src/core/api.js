// src/core/api.js
const API_BASE = "http://127.0.0.1:8000";

/**
 * 呼叫 Python 后端执行 Scheme C (逆向平衡)
 */
export async function fetchSchemeC(payload) {
    try {
        console.log("📡 正在呼叫 Python 后端...", payload);
        const response = await fetch(`${API_BASE}/calculate/scheme-c`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server Error: ${errText}`);
        }

        return await response.json();
    } catch (error) {
        console.error("API 通信失败:", error);
        throw error; // 抛出错误供 UI 捕获
    }
}